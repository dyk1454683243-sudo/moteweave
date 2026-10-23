import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function processExists(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    throw error
  }
}

function parseRows(stdout) {
  if (!stdout.trim()) return []
  return stdout.trim().split('\n').map((line) => {
    const values = line.trim().split(/\s+/).map(Number)
    if (values.length !== 2 || !values.every(Number.isSafeInteger)
      || values[0] <= 0 || values[1] < 0) throw new Error('invalid process snapshot')
    return values
  })
}

// Discover every descendant, including those in separate process groups, but
// avoid asking the OS for the resident memory of unrelated applications.
// Both queries share the original one-second deadline; no stale sample fallback.
export async function readProcessTree(rootPid, {
  run = execFileAsync,
  now = () => performance.now(),
  exists = processExists,
  onDiscover = () => {},
  signal,
} = {}) {
  const startedAt = now()
  const deadline = startedAt + 1000
  let isFirstQuery = true
  const query = async (args) => {
    signal?.throwIfAborted()
    const queryStartedAt = isFirstQuery ? startedAt : now()
    isFirstQuery = false
    const remaining = Math.floor(deadline - queryStartedAt)
    if (remaining <= 0) throw new Error('process snapshot deadline exceeded')
    let result
    try {
      result = await run('ps', args, {
        maxBuffer: 4 * 1024 * 1024,
        timeout: remaining,
        killSignal: 'SIGKILL',
        signal,
      })
    } catch (error) {
      error.message += ` [snapshot=${args[0] === '-axo' ? 'topology' : 'rss'}`
        + ` elapsed=${Math.round(now() - queryStartedAt)}ms budget=${remaining}ms`
        + ` stdout-bytes=${Buffer.byteLength(error.stdout ?? '')}]`
      throw error
    }
    signal?.throwIfAborted()
    if (now() >= deadline) throw new Error('process snapshot deadline exceeded')
    return parseRows(result.stdout)
  }
  const topology = await query(['-axo', 'pid=,ppid='])
  const childrenByParent = new Map()
  const present = new Set()
  for (const [pid, parentPid] of topology) {
    present.add(pid)
    const children = childrenByParent.get(parentPid) ?? []
    children.push(pid)
    childrenByParent.set(parentPid, children)
  }
  if (!present.has(rootPid)) {
    if (exists(rootPid)) throw new Error('live root missing from process snapshot')
    return { pids: [], rssKiB: 0 }
  }
  const pids = []
  const pending = [rootPid]
  const visited = new Set()
  for (let index = 0; index < pending.length; index += 1) {
    const pid = pending[index]
    if (visited.has(pid)) continue
    visited.add(pid)
    pids.push(pid)
    pending.push(...(childrenByParent.get(pid) ?? []))
  }
  // Cleanup must know about detached descendants even if the RSS query fails.
  // This notification is not a successful memory sample.
  onDiscover(pids)
  let rows
  try {
    rows = await query(['-p', pids.join(','), '-o', 'pid=,rss='])
  } catch (error) {
    // ps exits 1 if every selected process exited between the two queries.
    if (error.code !== 1 || pids.some(exists)) throw error
    return { pids: [], rssKiB: 0 }
  }
  const rssByPid = new Map(rows)
  if (rows.some(([pid]) => !visited.has(pid))) throw new Error('unexpected process in RSS snapshot')
  for (const pid of pids) {
    if (!rssByPid.has(pid) && exists(pid)) throw new Error('live descendant missing from RSS snapshot')
  }
  return {
    pids: [...rssByPid.keys()],
    rssKiB: rows.reduce((total, [, rss]) => total + rss, 0),
  }
}
