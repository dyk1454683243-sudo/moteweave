import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  EXTERNAL_TOOL_FAILURE,
  runGuardedTool,
} from '../../src/motion-source/guardedToolRunner.js'

const TEST_LIMITS = Object.freeze({
  maxRssMiB: 128,
  timeoutMs: 2000,
  pollIntervalMs: 25,
  terminationGraceMs: 40,
  maxOutputBytes: 1024,
  tool: 'test_tool',
})

function pidExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

async function waitForPidExit(pid, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs
  while (pidExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return !pidExists(pid)
}

test('guarded tool runner returns bounded diagnostics for a normal exit', async () => {
  const result = await runGuardedTool(
    process.execPath,
    ['-e', "process.stdout.write('ok'); process.stderr.write('note')"],
    TEST_LIMITS
  )

  assert.equal(result.exit_code, 0)
  assert.equal(result.stdout_tail, 'ok')
  assert.equal(result.stderr_tail, 'note')
  assert.ok(result.peak_rss_kib >= 0)
})

test('guarded tool runner reports a stable spawn failure', async () => {
  await assert.rejects(
    () => runGuardedTool(
      path.join(os.tmpdir(), `missing-motion-tool-binary-${process.pid}`),
      [],
      TEST_LIMITS
    ),
    (error) => {
      assert.equal(error.code, EXTERNAL_TOOL_FAILURE.SPAWN_FAILED)
      assert.equal(error.failure_status, EXTERNAL_TOOL_FAILURE.SPAWN_FAILED)
      return true
    }
  )
})

test('guarded tool runner terminates a command after its deadline', async () => {
  await assert.rejects(
    () => runGuardedTool(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      { ...TEST_LIMITS, timeoutMs: 60 }
    ),
    (error) => {
      assert.equal(error.code, EXTERNAL_TOOL_FAILURE.TIMEOUT)
      assert.ok(error.elapsed_ms < 1500)
      return true
    }
  )
})

test('guarded tool runner refuses to launch after an absolute deadline expires', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'guarded-tool-absolute-deadline-'))
  const markerPath = path.join(root, 'should-not-exist.txt')

  await assert.rejects(
    () => runGuardedTool(
      process.execPath,
      ['-e', "require('node:fs').writeFileSync(process.argv[1], 'launched')", markerPath],
      { ...TEST_LIMITS, deadlineAt: Date.now() - 1 }
    ),
    (error) => {
      assert.equal(error.code, EXTERNAL_TOOL_FAILURE.TIMEOUT)
      assert.equal(error.before_launch, true)
      return true
    }
  )
  await assert.rejects(() => readFile(markerPath), { code: 'ENOENT' })
})

test('guarded tool runner rechecks an absolute deadline after queue waiting', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'guarded-tool-queued-deadline-'))
  const markerPath = path.join(root, 'should-not-exist.txt')
  const first = runGuardedTool(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 120)'],
    TEST_LIMITS
  )
  const queued = runGuardedTool(
    process.execPath,
    ['-e', "require('node:fs').writeFileSync(process.argv[1], 'launched')", markerPath],
    { ...TEST_LIMITS, deadlineAt: Date.now() + 20 }
  )
  const queuedAssertion = assert.rejects(
    () => queued,
    (error) => {
      assert.equal(error.code, EXTERNAL_TOOL_FAILURE.TIMEOUT)
      assert.equal(error.before_launch, true)
      return true
    }
  )
  await first
  await queuedAssertion
  await assert.rejects(() => readFile(markerPath), { code: 'ENOENT' })
})

test('guarded tool runner measures the process tree against a tiny RSS ceiling', async () => {
  const script = `
    const { spawn } = require('node:child_process')
    spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    setInterval(() => {}, 1000)
  `
  await assert.rejects(
    () => runGuardedTool(
      process.execPath,
      ['-e', script],
      { ...TEST_LIMITS, maxRssMiB: 4, timeoutMs: 1500 }
    ),
    (error) => {
      assert.equal(error.code, EXTERNAL_TOOL_FAILURE.RSS_LIMIT)
      assert.ok(error.peak_rss_kib > 4 * 1024)
      assert.ok(error.peak_process_count >= 2)
      return true
    }
  )
})

test('guarded tool runner propagates AbortSignal cancellation', async () => {
  const controller = new AbortController()
  const pending = runGuardedTool(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    { ...TEST_LIMITS, signal: controller.signal }
  )
  setTimeout(() => controller.abort(), 50)

  await assert.rejects(
    () => pending,
    (error) => {
      assert.equal(error.code, EXTERNAL_TOOL_FAILURE.CANCELLED)
      return true
    }
  )
})

test('guarded tool runner removes an aborted command from the single-concurrency queue', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'guarded-tool-queued-cancel-'))
  const markerPath = path.join(root, 'should-not-exist.txt')
  const first = runGuardedTool(
    process.execPath,
    ['-e', 'setTimeout(() => {}, 120)'],
    TEST_LIMITS
  )
  const controller = new AbortController()
  const queued = runGuardedTool(
    process.execPath,
    ['-e', "require('node:fs').writeFileSync(process.argv[1], 'launched')", markerPath],
    { ...TEST_LIMITS, signal: controller.signal }
  )
  controller.abort()

  await assert.rejects(
    () => queued,
    (error) => {
      assert.equal(error.code, EXTERNAL_TOOL_FAILURE.CANCELLED)
      return true
    }
  )
  await first
  await assert.rejects(() => readFile(markerPath), { code: 'ENOENT' })
})

test('guarded tool runner retains only the configured stderr tail', async () => {
  await assert.rejects(
    () => runGuardedTool(
      process.execPath,
      ['-e', "process.stderr.write('x'.repeat(4096) + 'SAFE_TAIL'); process.exit(7)"],
      { ...TEST_LIMITS, maxOutputBytes: 128 }
    ),
    (error) => {
      assert.equal(error.code, EXTERNAL_TOOL_FAILURE.FAILED)
      assert.ok(Buffer.byteLength(error.stderr_tail) <= 128)
      assert.match(error.stderr_tail, /SAFE_TAIL$/)
      return true
    }
  )
})

test('guarded tool runner escalates to SIGKILL and removes an ignoring descendant', async () => {
  const descendantScript = "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"
  const rootScript = `
    const { spawn } = require('node:child_process')
    process.on('SIGTERM', () => {})
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: 'ignore' })
    process.stdout.write(String(child.pid))
    setInterval(() => {}, 1000)
  `
  let descendantPid = null
  await assert.rejects(
    () => runGuardedTool(
      process.execPath,
      ['-e', rootScript],
      { ...TEST_LIMITS, timeoutMs: 100, terminationGraceMs: 50 }
    ),
    (error) => {
      assert.equal(error.code, EXTERNAL_TOOL_FAILURE.TIMEOUT)
      descendantPid = Number(error.stdout_tail.trim())
      assert.ok(Number.isSafeInteger(descendantPid))
      assert.equal(error.signal, 'SIGKILL')
      return true
    }
  )

  assert.equal(await waitForPidExit(descendantPid), true)
})

test('guarded tool runner serializes all Motion media commands globally', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'guarded-tool-queue-'))
  const logPath = path.join(root, 'order.log')
  const script = `
    const { appendFileSync } = require('node:fs')
    const [logPath, label] = process.argv.slice(1)
    appendFileSync(logPath, 'start ' + label + '\\n')
    setTimeout(() => {
      appendFileSync(logPath, 'end ' + label + '\\n')
    }, 80)
  `

  await Promise.all([
    runGuardedTool(process.execPath, ['-e', script, logPath, 'a'], TEST_LIMITS),
    runGuardedTool(process.execPath, ['-e', script, logPath, 'b'], TEST_LIMITS),
  ])

  const order = (await readFile(logPath, 'utf8')).trim().split('\n')
  assert.deepEqual(order, ['start a', 'end a', 'start b', 'end b'])
})
