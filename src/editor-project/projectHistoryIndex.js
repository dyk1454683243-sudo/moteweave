import { constants as fsConstants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { resolveContainedRegularFile, writeTrustedRegularFile } from './paths.js'
import { spriteDocumentError } from './spriteDocumentValidation.js'

export const HISTORY_INDEX_LIMITS = Object.freeze({
  pageBytes: 16 * 1024,
  recordBytes: 2 * 1024 * 1024,
  entries: 32,
  depth: 8,
  cacheBytes: 8 * 1024 * 1024,
})
const HASH = /^[a-f0-9]{64}$/
const cache = new Map()
let cacheBytes = 0
const counters = { reads: 0, readBytes: 0, writes: 0, writeBytes: 0, hits: 0 }
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const encode = value => Buffer.from(`${JSON.stringify(value)}\n`)
const fail = message => { throw spriteDocumentError('artifact_integrity_failed', message) }

export function resetProjectHistoryCache() {
  cache.clear()
  cacheBytes = 0
  for (const key of Object.keys(counters)) counters[key] = 0
}

export function projectHistoryStatistics() {
  return { ...counters, cacheBytes, cacheEntries: cache.size }
}

const identity = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':')
function remember(key, bytes, fileIdentity) {
  if (bytes.length > HISTORY_INDEX_LIMITS.cacheBytes) return
  if (cache.has(key)) cacheBytes -= cache.get(key).bytes.length
  cache.delete(key)
  while (cache.size && cacheBytes + bytes.length > HISTORY_INDEX_LIMITS.cacheBytes) {
    const oldest = cache.keys().next().value
    cacheBytes -= cache.get(oldest).bytes.length
    cache.delete(oldest)
  }
  cache.set(key, { bytes: Buffer.from(bytes), identity: fileIdentity })
  cacheBytes += bytes.length
}

function objectPath(paths, kind, hash) {
  if (!['pages', 'records', 'legacy'].includes(kind) || typeof hash !== 'string' || !HASH.test(hash)) fail('invalid history reference')
  return path.join(paths.projectDir, 'history-v2', kind, `${hash}.json`)
}

export async function readHistoryBytes(paths, kind, hash) {
  const filePath = objectPath(paths, kind, hash)
  const limit = kind === 'pages' ? HISTORY_INDEX_LIMITS.pageBytes : HISTORY_INDEX_LIMITS.recordBytes
  const key = filePath
  let handle
  try {
    const resolved = await resolveContainedRegularFile({
      controlledRootPath: paths.workspaceRoot,
      rootPath: paths.projectDir,
      candidatePath: filePath,
      errorCode: 'unsafe_artifact_path',
    })
    if (resolved !== path.resolve(filePath)) fail('history reference traverses a symbolic link')
    handle = await open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > limit) fail('history file exceeds its byte limit')
    const cached = cache.get(key)
    if (cached && cached.identity === identity(stat)) {
      counters.hits += 1
      cache.delete(key)
      cache.set(key, cached)
      return Buffer.from(cached.bytes)
    }
    const bytes = Buffer.alloc(stat.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset !== stat.size || digest(bytes.subarray(0, offset)) !== hash) fail('history file hash does not match')
    const result = bytes.subarray(0, offset)
    counters.reads += 1
    counters.readBytes += offset
    remember(key, result, identity(stat))
    return Buffer.from(result)
  } catch (error) {
    if (error?.code === 'artifact_integrity_failed') throw error
    fail('committed history file cannot be read safely')
  } finally {
    await handle?.close()
  }
}

export async function readHistorySourceRoot(paths) {
  let handle
  try {
    const resolved = await resolveContainedRegularFile({ controlledRootPath: paths.workspaceRoot,
      rootPath: paths.projectDir, candidatePath: paths.projectJson, errorCode: 'unsafe_artifact_path' })
    if (resolved !== path.resolve(paths.projectJson)) fail('source index traverses a symbolic link')
    handle = await open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > HISTORY_INDEX_LIMITS.recordBytes) fail('unsafe source project index')
    const bytes = Buffer.alloc(stat.size + 1)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    if (offset !== stat.size || identity(await handle.stat()) !== identity(stat)) fail('source index changed during read')
    return bytes.subarray(0, offset)
  } finally { await handle?.close() }
}

export async function writeHistoryBytes(paths, kind, bytes, { fault = null } = {}) {
  const limit = kind === 'pages' ? HISTORY_INDEX_LIMITS.pageBytes : HISTORY_INDEX_LIMITS.recordBytes
  if (!Buffer.isBuffer(bytes) || bytes.length > limit) {
    throw spriteDocumentError('resource_limit', 'history file exceeds its byte limit', { limit })
  }
  const hash = digest(bytes)
  const filePath = objectPath(paths, kind, hash)
  try {
    // Bound the existing immutable-file read performed by the trusted writer.
    try {
      const stat = await lstat(filePath)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) fail('history destination is unsafe')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (fault === `history_${kind}`) throw spriteDocumentError('storage_commit_failed', 'history preparation failed')
    const result = await writeTrustedRegularFile({
      controlledRootPath: paths.workspaceRoot,
      filePath,
      bytes,
      exclusive: true,
      errorCode: 'unsafe_artifact_path',
      syncFault: fault === 'history_sync' ? 'parent' : null,
    })
    if (!result?.reused) {
      counters.writes += 1
      counters.writeBytes += bytes.length
    }
    remember(filePath, bytes, identity(await lstat(filePath)))
    return hash
  } catch (error) {
    if (['resource_limit', 'artifact_integrity_failed', 'storage_commit_failed'].includes(error?.code)) throw error
    // A published immutable preparation file is not a published project head.
    throw spriteDocumentError('storage_commit_failed', 'history preparation could not be persisted')
  }
}

function validatePage(page, tree, expectedLevel = null, expectedMax = null, lower = null) {
  if (page?.version !== 'editor_history_page_v1' || page.tree !== tree
    || !Number.isInteger(page.level) || page.level < 0 || page.level >= HISTORY_INDEX_LIMITS.depth
    || (expectedLevel !== null && page.level !== expectedLevel)
    || !Array.isArray(page.entries) || !page.entries.length || page.entries.length > HISTORY_INDEX_LIMITS.entries) {
    fail('invalid history page')
  }
  let previous = lower
  for (const entry of page.entries) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string'
      || !entry[0] || entry[0].length > 128 || (previous !== null && entry[0] <= previous)) fail('invalid history key order')
    if (typeof entry[1] !== 'string' || !HASH.test(entry[1])) fail('invalid history reference')
    previous = entry[0]
  }
  if (expectedMax !== null && previous !== expectedMax) fail('history child range does not match')
  return page
}

export function createProjectHistoryIndex(paths, tree, options = {}) {
  if (!['revisions', 'receipts'].includes(tree)) fail('invalid history tree')
  async function read(hash, level = null, max = null, lower = null) {
    let page
    try { page = JSON.parse((await readHistoryBytes(paths, 'pages', hash)).toString('utf8')) }
    catch (error) {
      if (error?.code) throw error
      fail('history page is not valid JSON')
    }
    return validatePage(page, tree, level, max, lower)
  }
  async function save(level, entries) {
    if (level >= HISTORY_INDEX_LIMITS.depth) throw spriteDocumentError('resource_limit', 'history tree is too deep')
    const page = validatePage({ version: 'editor_history_page_v1', tree, level, entries }, tree)
    return [entries.at(-1)[0], await writeHistoryBytes(paths, 'pages', encode(page), options)]
  }
  async function get(root, key) {
    if (root === null) return null
    let hash = root, level = null, max = null, lower = null
    for (let depth = 0; depth < HISTORY_INDEX_LIMITS.depth; depth += 1) {
      const page = await read(hash, level, max, lower)
      const slot = page.entries.findIndex(entry => entry[0] >= key)
      if (slot < 0) return null
      const entry = page.entries[slot]
      if (page.level === 0) return entry[0] === key ? entry[1] : null
      lower = slot ? page.entries[slot - 1][0] : lower
      ;[max, hash] = entry
      level = page.level - 1
    }
    fail('history lookup exceeds depth limit')
  }
  async function put(root, key, value) {
    async function insert(hash, level = null, max = null, lower = null) {
      const page = hash === null ? { level: 0, entries: [] } : await read(hash, level, max, lower)
      const entries = page.entries.slice()
      let slot = entries.findIndex(entry => entry[0] >= key)
      if (page.level === 0) {
        if (slot >= 0 && entries[slot][0] === key) {
          if (JSON.stringify(entries[slot][1]) !== JSON.stringify(value)) fail('committed history record cannot be replaced')
          return { level: 0, refs: [[entries.at(-1)[0], hash]] }
        }
        entries.splice(slot < 0 ? entries.length : slot, 0, [key, value])
      } else {
        if (slot < 0) slot = entries.length - 1
        const [childMax, childHash] = entries[slot]
        const child = await insert(childHash, page.level - 1, childMax, slot ? entries[slot - 1][0] : lower)
        entries.splice(slot, 1, ...child.refs)
      }
      if (entries.length <= HISTORY_INDEX_LIMITS.entries) return { level: page.level, refs: [await save(page.level, entries)] }
      const middle = Math.ceil(entries.length / 2)
      return { level: page.level, refs: [await save(page.level, entries.slice(0, middle)), await save(page.level, entries.slice(middle))] }
    }
    const result = await insert(root)
    return result.refs.length === 1 ? result.refs[0][1] : (await save(result.level + 1, result.refs))[1]
  }
  async function build(entries) {
    if (!entries.length) return null
    const sorted = entries.slice().sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
    for (let i = 1; i < sorted.length; i += 1) if (sorted[i - 1][0] >= sorted[i][0]) fail('duplicate migration history key')
    let level = 0, current = sorted
    while (true) {
      const refs = []
      for (let i = 0; i < current.length; i += HISTORY_INDEX_LIMITS.entries) refs.push(await save(level, current.slice(i, i + HISTORY_INDEX_LIMITS.entries)))
      if (refs.length === 1) return refs[0][1]
      current = refs
      level += 1
    }
  }
  async function* entries(root, { maxPages = 8192, maxRecords = 100000 } = {}) {
    if (![maxPages, maxRecords].every(n => Number.isSafeInteger(n) && n > 0 && n <= 1000000)) {
      throw spriteDocumentError('resource_limit', 'invalid history traversal budget')
    }
    let pages = 0, records = 0
    async function* walk(hash, level = null, max = null, lower = null) {
      if (++pages > maxPages) throw spriteDocumentError('resource_limit', 'history traversal page budget exceeded')
      const page = await read(hash, level, max, lower)
      if (!page.level) {
        for (const entry of page.entries) {
          if (++records > maxRecords) throw spriteDocumentError('resource_limit', 'history traversal record budget exceeded')
          yield entry
        }
        return
      }
      for (const [upper, child] of page.entries) {
        yield* walk(child, page.level - 1, upper, lower)
        lower = upper
      }
    }
    if (root !== null) yield* walk(root)
  }
  return { get, put, build, entries }
}

export function documentHistoryKey(documentId, revision) {
  if (typeof documentId !== 'string' || !Number.isSafeInteger(revision) || revision <= 0) fail('invalid document history key')
  return `${digest(Buffer.from(documentId))}:${String(revision).padStart(16, '0')}`
}

export async function writeHistoryReceipt(paths, receipt, options) {
  return writeHistoryBytes(paths, 'records', encode(receipt), options)
}

export async function readHistoryReceiptRecord(paths, hash) {
  try {
    const record = JSON.parse((await readHistoryBytes(paths, 'records', hash)).toString('utf8'))
    if (!record || typeof record !== 'object' || Array.isArray(record)) fail('history record is not an object')
    return record
  }
  catch (error) {
    if (error?.code) throw error
    fail('history receipt is not valid JSON')
  }
}
