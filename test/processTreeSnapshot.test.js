import assert from 'node:assert/strict'
import test from 'node:test'
import { readProcessTree } from '../src/processTreeSnapshot.js'

test('snapshot reads RSS only for the complete descendant tree', async () => {
  const calls = []
  const result = await readProcessTree(10, {
    run: async (command, args, options) => {
      calls.push({ command, args, options })
      return { stdout: calls.length === 1
        ? '1 0\n10 1\n11 10\n12 11\n99 1\n' : '10 100\n11 200\n12 300\n' }
    },
    now: () => 0,
  })
  assert.deepEqual(result, { pids: [10, 11, 12], rssKiB: 600 })
  assert.deepEqual(calls.map(({ args }) => args), [
    ['-axo', 'pid=,ppid='], ['-p', '10,11,12', '-o', 'pid=,rss='],
  ])
  assert.ok(calls.every(({ options }) => options.timeout === 1000
    && options.killSignal === 'SIGKILL' && options.maxBuffer === 4 * 1024 * 1024))
})

test('both snapshot queries share one second and late results fail closed', async () => {
  let elapsed = 0
  let count = 0
  await assert.rejects(readProcessTree(10, {
    now: () => elapsed,
    run: async (command, args, options) => {
      count += 1
      if (count === 1) {
        assert.equal(options.timeout, 1000)
        elapsed = 650
        return { stdout: '10 1' }
      }
      assert.equal(options.timeout, 350)
      elapsed = 1001
      return { stdout: '10 100' }
    },
  }), /deadline exceeded/)
  assert.equal(count, 2)
})

test('a genuinely failed sampler is not retried or replaced with stale memory', async () => {
  let calls = 0
  await assert.rejects(readProcessTree(10, {
    run: async () => { calls += 1; throw new Error('sampler failed') },
  }), /sampler failed/)
  assert.equal(calls, 1)
})

test('live descendants missing memory data fail closed', async () => {
  let calls = 0
  let discovered
  await assert.rejects(readProcessTree(10, {
    run: async () => ({ stdout: ++calls === 1 ? '10 1\n11 10' : '10 100' }),
    exists: () => true,
    onDiscover: (pids) => { discovered = pids },
  }), /live descendant missing/)
  assert.deepEqual(discovered, [10, 11])
})

test('processes exiting between topology and RSS queries are not monitor failures', async () => {
  let calls = 0
  const result = await readProcessTree(10, {
    run: async () => {
      if (++calls === 1) return { stdout: '10 1' }
      throw Object.assign(new Error('no matching processes'), { code: 1 })
    },
    exists: () => false,
  })
  assert.deepEqual(result, { pids: [], rssKiB: 0 })
})

test('invalid or incomplete topology cannot claim an empty live tree', async () => {
  await assert.rejects(readProcessTree(10, {
    run: async () => ({ stdout: 'invalid' }), exists: () => true,
  }), /invalid process snapshot/)
  await assert.rejects(readProcessTree(10, {
    run: async () => ({ stdout: '1 0' }), exists: () => true,
  }), /live root missing/)
})

test('sub-millisecond clock advance before topology query preserves full 1000ms budget', async () => {
  const ticks = [100.125, 500.0, 500.45, 600.0]
  let idx = 0
  const timeouts = []
  const result = await readProcessTree(10, {
    now: () => ticks[Math.min(idx++, ticks.length - 1)],
    run: async (_cmd, _args, options) => {
      timeouts.push(options.timeout)
      return { stdout: timeouts.length === 1 ? '10 1\n' : '10 256\n' }
    },
  })
  assert.deepEqual(result, { pids: [10], rssKiB: 256 })
  assert.equal(timeouts[0], 1000, 'initial topology query receives full 1000ms budget instead of 999ms')
  assert.equal(timeouts[1], 599)
})
