import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import path from 'node:path'
import { resolveEditorProjectPaths, resolveContainedRegularFile, writeTrustedRegularFile } from './paths.js'

// Small project-owned sidecars, separate from document revisions and native login state.
// Callers supply IDs, never arbitrary filenames. No cleanup or transcript scanning.
export function createRuntimeRecords() {
  function target(scope, group, id, extension) {
    if (!['images', 'conversations', 'grants', 'sheets'].includes(group) || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('invalid runtime record')
    const paths = resolveEditorProjectPaths(scope)
    const rootPath = path.join(paths.projectDir, 'runtime', group)
    return { controlledRootPath: paths.workspaceRoot, rootPath, candidatePath: path.join(rootPath, `${id}.${extension}`) }
  }
  async function read(scope, group, id, extension, maxBytes) {
    const location = target(scope, group, id, extension)
    let file
    try { file = await resolveContainedRegularFile({ ...location, errorCode: 'runtime_storage_failed' }) }
    catch (error) { if (error.code === 'artifact_not_found') return null; throw error }
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > maxBytes) throw new Error('runtime record exceeds limit')
      const bytes = Buffer.alloc(info.size)
      let offset = 0
      while (offset < bytes.length) {
        const result = await handle.read(bytes, offset, bytes.length - offset, offset)
        if (!result.bytesRead) throw new Error('runtime record truncated')
        offset += result.bytesRead
      }
      return bytes
    } finally { await handle.close() }
  }
  async function write(scope, group, id, extension, bytes) {
    const location = target(scope, group, id, extension)
    await writeTrustedRegularFile({ controlledRootPath: location.controlledRootPath,
      filePath: location.candidatePath, bytes, errorCode: 'runtime_storage_failed' })
  }
  return {
    async get(scope, group, id) {
      const bytes = await read(scope, group, id, 'json', 2 * 1024 * 1024)
      return bytes ? JSON.parse(bytes.toString('utf8')) : null
    },
    async put(scope, group, id, value) {
      const bytes = Buffer.from(JSON.stringify(value))
      if (bytes.length > 2 * 1024 * 1024) throw new Error('runtime record exceeds limit')
      await write(scope, group, id, 'json', bytes)
    },
    getBytes: (scope, id) => read(scope, 'images', id, 'bin', 32 * 1024 * 1024),
    putBytes: (scope, id, bytes) => write(scope, 'images', id, 'bin', bytes),
    getGroupBytes: (scope, group, id) => read(scope, group, id, 'bin', 32 * 1024 * 1024),
    putGroupBytes: (scope, group, id, bytes) => write(scope, group, id, 'bin', bytes),
  }
}
