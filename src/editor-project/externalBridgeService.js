import { createHash, randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  EXTERNAL_BRIDGE_COMPATIBILITY,
  externalPixelSessions,
  inspectExternalBridgeTarget,
} from './externalPixelSession.js'
import {
  EXTERNAL_BRIDGE_OPERATIONS,
  issueExternalBridgeGrant,
  revokePixelScopeGrant,
  verifyExternalBridgeGrant,
} from './pixelScopeGrants.js'
import {
  ensureTrustedContainedDirectory,
  resolveContainedRegularFile,
  resolveEditorProjectPaths,
  writeTrustedRegularFile,
} from './paths.js'
import { loadEditorProject, withEditorProjectMutationLock } from './projectStore.js'
import { getSpriteDocument, readSpriteBlock } from './spriteDocumentStore.js'
import { EXTERNAL_TOOL_FAILURE, runGuardedTool } from '../motion-source/guardedToolRunner.js'
import {
  DEFAULT_MCP_STDIO_SCRIPT_PATH,
  buildTaskScopedCodexMcpCommand,
  formatTaskScopedCodexMcpCommandLine,
} from '../../scripts/pixel-mcp-stdio.mjs'

export const APPROVED_ASEPRITE_EXECUTABLE = path.join(homedir(), 'Library/Application Support/Steam/steamapps/common/Aseprite/Aseprite.app/Contents/MacOS/aseprite')
export const REJECTED_ASEPRITE_WRAPPER_PREFIX = path.join(homedir(), 'Applications/Aseprite.app')
export const EXTERNAL_BRIDGE_LIMITS = Object.freeze({
  maxLiveCheckouts: 4,
  maxReturnAttempts: 3,
  checkoutTtlMs: 15 * 60 * 1000,
  maxSidecarBytes: 16 * 1024,
  maxAsepriteFileBytes: 8 * 1024 * 1024,
  maxDecodedRgbaBytes: EXTERNAL_BRIDGE_COMPATIBILITY.rgbaByteLength,
  maxTotalCheckoutStorageBytes: 128 * 1024 * 1024,
  cliTimeoutMs: 60000,
  cliMaxRssMiB: 2048,
})

const BRIDGE_LUA_PATH = fileURLToPath(new URL('./aseprite/bridge.lua', import.meta.url))
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const CHECKOUT_ID_RE = /^chk_[a-f0-9]{32}$/i
const GRANT_ID_RE = /^grant_[a-f0-9]{32}$/i
const ASEPRITE_MAGIC = 0xa5e0
const ASEPRITE_FRAME_MAGIC = 0xf1fa
const ASEPRITE_CEL_CHUNK = 0x2005

const sha256Hex = bytes => createHash('sha256').update(bytes).digest('hex')
const jsonHash = value => sha256Hex(Buffer.from(JSON.stringify(value), 'utf8'))

const bridgeQueues = new Map()
async function withBridgeLock(scope, fn) {
  const workspaceRoot = scope.workspaceRoot ?? path.join(scope.projectRoot, 'workspace')
  const key = `${path.resolve(workspaceRoot)}:${scope.projectId}`
  const prior = bridgeQueues.get(key) ?? Promise.resolve()
  let release
  const gate = new Promise(resolve => { release = resolve })
  const queued = prior.then(() => gate)
  bridgeQueues.set(key, queued)
  await prior
  try {
    return await withEditorProjectMutationLock({ projectId: scope.projectId, workspaceRoot }, fn)
  } finally {
    release()
    if (bridgeQueues.get(key) === queued) bridgeQueues.delete(key)
  }
}

function bridgeError(code, message, httpStatus = 409, diagnostic = null) {
  return Object.assign(new Error(message || code), {
    code,
    http_status: httpStatus,
    ...(diagnostic ? { diagnostic } : {}),
  })
}

export async function defaultAsepriteExec(executablePath, args, options = {}) {
  const res = await runGuardedTool(executablePath, args, {
    timeoutMs: options.timeout ?? EXTERNAL_BRIDGE_LIMITS.cliTimeoutMs,
    maxRssMiB: options.maxRssMiB ?? EXTERNAL_BRIDGE_LIMITS.cliMaxRssMiB,
    pollIntervalMs: options.pollIntervalMs ?? 250,
    maxOutputBytes: options.maxBuffer ?? 512 * 1024,
    cwd: options.cwd,
    tool: 'aseprite',
  })
  return {
    stdout: res.stdout_tail,
    stderr: res.stderr_tail,
    peak_rss_kib: res.peak_rss_kib,
    elapsed_ms: res.elapsed_ms,
  }
}

export function inspectAsepriteBinaryHeader(aseBytes) {
  if (!aseBytes || aseBytes.length < 128) {
    return {
      ok: false,
      rule: 'file_truncated',
      message: 'The .aseprite working copy is missing or truncated.',
    }
  }
  const magic = aseBytes.readUInt16LE(4)
  if (magic !== ASEPRITE_MAGIC) {
    return {
      ok: false,
      rule: 'invalid_magic',
      message: 'The working copy is not a valid native .aseprite file (PNG or foreign file substitution is prohibited).',
    }
  }
  const headerFileSize = aseBytes.readUInt32LE(0)
  if (headerFileSize !== aseBytes.length || aseBytes.length < 144) {
    return {
      ok: false,
      rule: 'file_truncated',
      message: 'The .aseprite working copy is truncated or its header byte size does not match the file length.',
    }
  }
  const frames = aseBytes.readUInt16LE(6)
  const width = aseBytes.readUInt16LE(8)
  const height = aseBytes.readUInt16LE(10)
  const colorDepth = aseBytes.readUInt16LE(12)
  const pixelRatioW = aseBytes[94]
  const pixelRatioH = aseBytes[95]
  const bytesPerPixel = colorDepth === 32 ? 4 : colorDepth === 16 ? 2 : 1
  const celHeaders = []

  let offset = 128
  for (let f = 0; f < frames; f++) {
    if (offset + 16 > aseBytes.length) {
      return {
        ok: false,
        rule: 'file_truncated',
        message: 'The .aseprite working copy has a truncated frame header.',
      }
    }
    const frameBytes = aseBytes.readUInt32LE(offset)
    const frameMagic = aseBytes.readUInt16LE(offset + 4)
    const oldChunks = aseBytes.readUInt16LE(offset + 6)
    const newChunks = aseBytes.readUInt32LE(offset + 12)
    const chunkCount = newChunks !== 0 ? newChunks : oldChunks
    if (frameMagic !== ASEPRITE_FRAME_MAGIC || frameBytes < 16 || offset + frameBytes > aseBytes.length) {
      return {
        ok: false,
        rule: 'file_truncated',
        message: 'The .aseprite working copy has an invalid or truncated frame payload.',
      }
    }
    let chunkOffset = offset + 16
    const frameEnd = offset + frameBytes
    for (let c = 0; c < chunkCount; c++) {
      if (chunkOffset + 6 > frameEnd) {
        return {
          ok: false,
          rule: 'file_truncated',
          message: 'The .aseprite working copy has a truncated chunk header.',
        }
      }
      const chunkSize = aseBytes.readUInt32LE(chunkOffset)
      const chunkType = aseBytes.readUInt16LE(chunkOffset + 4)
      if (chunkSize < 6 || chunkOffset + chunkSize > frameEnd) {
        return {
          ok: false,
          rule: 'file_truncated',
          message: 'The .aseprite working copy has a truncated chunk payload.',
        }
      }
      if (chunkType === ASEPRITE_CEL_CHUNK) {
        if (chunkSize < 22) {
          return {
            ok: false,
            rule: 'file_truncated',
            message: 'The .aseprite working copy has a truncated cel chunk header.',
          }
        }
        const layerIndex = aseBytes.readUInt16LE(chunkOffset + 6)
        const celX = aseBytes.readInt16LE(chunkOffset + 8)
        const celY = aseBytes.readInt16LE(chunkOffset + 10)
        const celOpacity = aseBytes[chunkOffset + 12]
        const celType = aseBytes.readUInt16LE(chunkOffset + 13)
        const celZIndex = aseBytes.readInt16LE(chunkOffset + 15)
        let celWidth = 0
        let celHeight = 0
        if (celType === 0 || celType === 2) {
          if (chunkSize < 26) {
            return {
              ok: false,
              rule: 'file_truncated',
              message: 'The .aseprite working copy has a truncated raster cel header.',
            }
          }
          celWidth = aseBytes.readUInt16LE(chunkOffset + 22)
          celHeight = aseBytes.readUInt16LE(chunkOffset + 24)
          if (celType === 0 && chunkSize !== 26 + celWidth * celHeight * bytesPerPixel) {
            return {
              ok: false,
              rule: 'file_truncated',
              message: 'The .aseprite raw cel payload size does not match its dimensions.',
            }
          }
          if (celType === 2 && chunkSize < 28) {
            return {
              ok: false,
              rule: 'file_truncated',
              message: 'The .aseprite compressed cel payload is truncated.',
            }
          }
        }
        celHeaders.push({
          frameIndex: f,
          layerIndex,
          celX,
          celY,
          celOpacity,
          celType,
          celZIndex,
          celWidth,
          celHeight,
        })
      }
      chunkOffset += chunkSize
    }
    if (chunkOffset !== frameEnd) {
      return {
        ok: false,
        rule: 'file_truncated',
        message: 'The .aseprite frame size does not match its chunk payloads.',
      }
    }
    offset += frameBytes
  }
  if (offset !== aseBytes.length) {
    return {
      ok: false,
      rule: 'file_truncated',
      message: 'The .aseprite working copy contains trailing or truncated frame bytes.',
    }
  }
  if (width !== EXTERNAL_BRIDGE_COMPATIBILITY.width || height !== EXTERNAL_BRIDGE_COMPATIBILITY.height) {
    return {
      ok: false,
      rule: 'canvas_dimensions',
      message: `Returned sprite dimensions (${width}×${height}) do not match ${EXTERNAL_BRIDGE_COMPATIBILITY.width}×${EXTERNAL_BRIDGE_COMPATIBILITY.height}.`,
    }
  }
  if (frames !== EXTERNAL_BRIDGE_COMPATIBILITY.maxFrames) {
    return {
      ok: false,
      rule: 'frame_count',
      message: 'Adding or deleting frames is not supported in external edit return.',
    }
  }
  if (colorDepth !== 32) {
    return {
      ok: false,
      rule: 'color_mode',
      message: 'Returned sprite must remain in 32-bit RGBA color mode.',
    }
  }
  if ((pixelRatioW !== 0 || pixelRatioH !== 0) && (pixelRatioW !== 1 || pixelRatioH !== 1)) {
    return {
      ok: false,
      rule: 'unsupported_metadata',
      message: 'Returned sprite modified pixel aspect ratio.',
    }
  }
  if (celHeaders.length !== 1) {
    return {
      ok: false,
      rule: 'cel_structure',
      message: 'Returned sprite must contain exactly one cel on the target layer and frame.',
    }
  }
  const celHeader = celHeaders[0]
  const decodedCelBytes = celHeader.celWidth * celHeader.celHeight * 4
  if (
    (celHeader.celType !== 0 && celHeader.celType !== 2)
    || celHeader.celWidth < 1
    || celHeader.celHeight < 1
    || celHeader.celX < 0
    || celHeader.celY < 0
    || celHeader.celX + celHeader.celWidth > width
    || celHeader.celY + celHeader.celHeight > height
    || decodedCelBytes > EXTERNAL_BRIDGE_COMPATIBILITY.rgbaByteLength
    || celHeader.celOpacity !== 255
    || celHeader.celZIndex !== 0
  ) {
    return {
      ok: false,
      rule: 'cel_structure',
      message: 'Returned cel type, bounds, decoded byte size, opacity, or metadata are outside the supported compatibility boundary.',
    }
  }
  return {
    ok: true,
    width,
    height,
    frames,
    colorDepth,
    cel: celHeader,
  }
}

export async function probeAsepriteExecutable({
  executablePath = APPROVED_ASEPRITE_EXECUTABLE,
  execImpl = defaultAsepriteExec,
} = {}) {
  if (typeof executablePath !== 'string' || !executablePath || !path.isAbsolute(executablePath)) {
    return { available: false, reason: 'executable_invalid', version: null }
  }
  const normalized = path.resolve(executablePath)
  if (normalized.startsWith(REJECTED_ASEPRITE_WRAPPER_PREFIX) || normalized.endsWith('.sh')) {
    return { available: false, reason: 'wrapper_prohibited', version: null }
  }
  try {
    const linkInfo = await lstat(normalized)
    if (!linkInfo.isFile() || linkInfo.isSymbolicLink()) {
      return { available: false, reason: 'executable_not_regular_file', version: null }
    }
    const { stdout } = await execImpl(normalized, ['--version'], {
      timeout: 5000,
      maxBuffer: 64 * 1024,
    })
    const version = String(stdout || '').trim()
    if (!/^Aseprite\s+1\.3\./i.test(version)) {
      return { available: false, reason: 'version_unsupported', version: version || null }
    }
    return { available: true, reason: null, version, executablePath: normalized }
  } catch {
    return { available: false, reason: 'executable_unavailable', version: null }
  }
}

function resolveBridgeRootPaths(scope, checkoutId = null) {
  const paths = resolveEditorProjectPaths(scope)
  const bridgeRoot = path.join(paths.projectDir, 'runtime', 'external-bridge')
  if (!checkoutId) {
    return { controlledRootPath: paths.workspaceRoot, projectDir: paths.projectDir, bridgeRoot }
  }
  if (!CHECKOUT_ID_RE.test(checkoutId)) {
    throw bridgeError('invalid_pixel_tool_request', 'Invalid checkout ID.', 400)
  }
  const checkoutDir = path.join(bridgeRoot, checkoutId)
  return {
    controlledRootPath: paths.workspaceRoot,
    projectDir: paths.projectDir,
    bridgeRoot,
    checkoutDir,
    receiptPath: path.join(checkoutDir, 'receipt.json'),
    diagnosticPath: path.join(checkoutDir, 'diagnostic.json'),
    sourceRgbaPath: path.join(checkoutDir, 'source.rgba'),
    workingCopyPath: path.join(checkoutDir, 'working-copy.aseprite'),
  }
}

async function readBoundedFileWithIdentity(controlledRootPath, rootPath, candidatePath, maxBytes) {
  let resolved
  try {
    resolved = await resolveContainedRegularFile({
      controlledRootPath,
      rootPath,
      candidatePath,
      errorCode: 'runtime_storage_failed',
    })
  } catch (error) {
    if (error?.code === 'artifact_not_found') return null
    throw bridgeError('aseprite_return_invalid', 'Checkout file path is invalid or unsafe.', 422, { rule: 'unsafe_path' })
  }
  const handle = await open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  try {
    const info = await handle.stat()
    if (!info.isFile() || info.size > maxBytes) {
      throw bridgeError('aseprite_return_invalid', `File exceeds maximum size of ${maxBytes} bytes.`, 422, { rule: 'file_size_limit' })
    }
    const bytes = Buffer.alloc(info.size)
    let offset = 0
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) throw bridgeError('aseprite_return_invalid', 'File read was truncated.', 422, { rule: 'file_truncated' })
      offset += bytesRead
    }
    return {
      bytes,
      size: info.size,
      dev: info.dev,
      ino: info.ino,
      mtimeMs: info.mtimeMs,
      resolvedPath: resolved,
    }
  } finally {
    await handle.close()
  }
}

async function readBoundedFile(controlledRootPath, rootPath, candidatePath, maxBytes) {
  const res = await readBoundedFileWithIdentity(controlledRootPath, rootPath, candidatePath, maxBytes)
  return res ? res.bytes : null
}

async function writeBoundedJsonSidecar(controlledRootPath, filePath, value, { exclusive = false } = {}) {
  const bytes = Buffer.from(JSON.stringify(value), 'utf8')
  if (bytes.length > EXTERNAL_BRIDGE_LIMITS.maxSidecarBytes) {
    throw bridgeError('runtime_storage_failed', 'Checkout sidecar exceeds 16 KiB limit.', 500)
  }
  await writeTrustedRegularFile({
    controlledRootPath,
    filePath,
    bytes,
    exclusive,
    errorCode: 'runtime_storage_failed',
  })
}

async function readCheckoutReceipt(paths, { allowMissing = false } = {}) {
  let dirStat
  try {
    dirStat = await lstat(paths.checkoutDir)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      if (allowMissing) return null
      throw bridgeError('aseprite_checkout_not_found', 'External edit copy not found.', 404)
    }
    throw error
  }
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
    throw bridgeError('aseprite_return_invalid', 'Checkout directory path is invalid or unsafe.', 422, { rule: 'unsafe_path' })
  }
  try {
    await ensureTrustedContainedDirectory({
      controlledRootPath: paths.controlledRootPath,
      directoryPath: paths.checkoutDir,
      errorCode: 'runtime_storage_failed',
    })
  } catch {
    throw bridgeError('aseprite_return_invalid', 'Checkout directory failed containment check.', 422, { rule: 'unsafe_path' })
  }
  const receiptFile = await readBoundedFileWithIdentity(
    paths.controlledRootPath,
    paths.checkoutDir,
    paths.receiptPath,
    EXTERNAL_BRIDGE_LIMITS.maxSidecarBytes,
  )
  if (!receiptFile) {
    throw bridgeError('aseprite_return_invalid', 'Checkout directory is incomplete or missing receipt.json.', 422, { rule: 'incomplete_checkout' })
  }
  let receipt
  try {
    receipt = JSON.parse(receiptFile.bytes.toString('utf8'))
  } catch {
    throw bridgeError('aseprite_return_invalid', 'Checkout receipt.json is corrupt.', 422, { rule: 'corrupt_receipt' })
  }
  if (!receipt || typeof receipt !== 'object' || receipt.checkout_id !== path.basename(paths.checkoutDir) || receipt.status === 'creating') {
    throw bridgeError('aseprite_return_invalid', 'Checkout receipt is incomplete.', 422, { rule: 'incomplete_checkout' })
  }
  return receipt
}

async function inspectBridgeStorage(scope, nowMs) {
  const { controlledRootPath, bridgeRoot } = resolveBridgeRootPaths(scope)
  let rootStat = null
  try {
    rootStat = await lstat(bridgeRoot)
  } catch (error) {
    if (error?.code === 'ENOENT') return { totalBytes: 0, liveCheckouts: [], allCheckouts: [] }
    throw error
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw bridgeError('aseprite_return_invalid', 'External bridge directory is unsafe.', 422, { rule: 'unsafe_path' })
  }
  await ensureTrustedContainedDirectory({
    controlledRootPath,
    directoryPath: bridgeRoot,
    errorCode: 'runtime_storage_failed',
  })
  const entries = await readdir(bridgeRoot, { withFileTypes: true })
  let totalBytes = 0
  const liveCheckouts = []
  const allCheckouts = []
  for (const entry of entries) {
    const entryPath = path.join(bridgeRoot, entry.name)
    if (entry.isSymbolicLink()) {
      throw bridgeError('aseprite_return_invalid', 'External bridge directory contains a symbolic link.', 422, { rule: 'unsafe_path' })
    }
    if (entry.isFile()) {
      const st = await lstat(entryPath)
      if (st.isFile() && !st.isSymbolicLink()) totalBytes += st.size
      continue
    }
    if (!entry.isDirectory() || !CHECKOUT_ID_RE.test(entry.name)) continue
    const checkoutId = entry.name
    const paths = resolveBridgeRootPaths(scope, checkoutId)
    await ensureTrustedContainedDirectory({
      controlledRootPath,
      directoryPath: paths.checkoutDir,
      errorCode: 'runtime_storage_failed',
    })
    const files = await readdir(paths.checkoutDir, { withFileTypes: true })
    for (const f of files) {
      const fPath = path.join(paths.checkoutDir, f.name)
      const st = await lstat(fPath)
      if (st.isSymbolicLink()) {
        throw bridgeError('aseprite_return_invalid', 'Checkout directory contains a symbolic link.', 422, { rule: 'unsafe_path' })
      }
      if (st.isFile()) totalBytes += st.size
    }
    const receipt = await readCheckoutReceipt(paths, { allowMissing: false })
    allCheckouts.push(receipt)
    const expiresMs = Date.parse(receipt.expires_at || '')
    const isExpired = !Number.isFinite(expiresMs) || nowMs > expiresMs
    const isLive = !receipt.revoked_at && !receipt.closed_at && !receipt.discarded_at && !isExpired
    if (isLive) liveCheckouts.push(receipt)
  }
  return { totalBytes, liveCheckouts, allCheckouts }
}

function parsePrefixedJson(stdout, prefix) {
  const lines = String(stdout || '').split(/\r?\n/)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith(prefix)) {
      return JSON.parse(lines[i].slice(prefix.length))
    }
  }
  throw new Error(`Missing ${prefix} in Aseprite output`)
}

export function createExternalBridgeService({
  load = loadEditorProject,
  readDocument = getSpriteDocument,
  readBlock = readSpriteBlock,
  sessions = externalPixelSessions,
  asepriteExecutable = APPROVED_ASEPRITE_EXECUTABLE,
  execImpl = defaultAsepriteExec,
  now = Date.now,
  ttlMs = EXTERNAL_BRIDGE_LIMITS.checkoutTtlMs,
  maxTotalCheckoutStorageBytes = EXTERNAL_BRIDGE_LIMITS.maxTotalCheckoutStorageBytes,
} = {}) {
  async function loadTargetContext(scope, canvasId) {
    const { project } = await load(scope)
    const selectedCanvasId = canvasId || Object.keys(project?.canvases || {})[0] || null
    const canvas = selectedCanvasId ? project?.canvases?.[selectedCanvasId] : null
    if (!canvas?.document_id) {
      return { project, canvas: null, manifest: null, rgba: null, targetCheck: { supported: false, reason: 'no_canvas', message: 'Select a 64×64 canvas to use external tools.' } }
    }
    const { manifest } = await readDocument({ ...scope, documentId: canvas.document_id })
    const cels = Object.values(manifest?.cels || {})
    const cel = cels[0] || null
    let rgba = null
    if (cel && manifest?.canvas?.w === EXTERNAL_BRIDGE_COMPATIBILITY.width && manifest?.canvas?.h === EXTERNAL_BRIDGE_COMPATIBILITY.height) {
      if (cel.block) {
        const block = await readBlock({ ...scope, documentId: canvas.document_id, sha256: cel.block.sha256 })
        rgba = block.bytes
      } else {
        rgba = new Uint8Array(EXTERNAL_BRIDGE_COMPATIBILITY.rgbaByteLength)
      }
    }
    const targetCheck = inspectExternalBridgeTarget(manifest, rgba)
    return { project, canvas, manifest, rgba, targetCheck }
  }

  return {
    async status(scope, { canvasId = null, grantId = null } = {}) {
      const nowMs = now()
      const [{ project, canvas, manifest, rgba, targetCheck }, asepriteProbe, storage] = await Promise.all([
        loadTargetContext(scope, canvasId),
        probeAsepriteExecutable({ executablePath: asepriteExecutable, execImpl }),
        inspectBridgeStorage(scope, nowMs),
      ])
      const activeCanvasId = canvas?.id || canvasId || null
      const canvasSessions = activeCanvasId ? sessions.listForCanvas(scope, activeCanvasId) : []
      const activeSessionIds = new Set(canvasSessions.map(s => s.session_id))
      const canvasCheckouts = storage.allCheckouts
        .filter(r => !activeCanvasId || r.canvas_id === activeCanvasId)
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
        .slice(0, 8)
        .map(r => {
          const expiresMs = Date.parse(r.expires_at || '')
          const expired = !Number.isFinite(expiresMs) || nowMs > expiresMs
          const stale = Boolean(project && manifest && (r.project_revision !== project.revision || r.working_revision !== manifest.revision))
          const discarded = Boolean(r.discarded_at || r.closed_at || (r.candidate_session_id && !activeSessionIds.has(r.candidate_session_id)))
          const activeCandidateId = (!discarded && r.candidate_session_id && activeSessionIds.has(r.candidate_session_id))
            ? r.candidate_session_id
            : null
          return {
            checkout_id: r.checkout_id,
            grant_id: r.grant_id,
            canvas_id: r.canvas_id,
            working_copy_path: r.working_copy_path,
            allowed_rect: r.allowed_rect,
            source_sha256: r.source_sha256,
            checkout_file_sha256: r.checkout_file_sha256,
            returned_file_sha256: r.returned_file_sha256 || null,
            candidate_session_id: activeCandidateId,
            review_path: activeCandidateId ? r.review_path : null,
            return_attempts: r.return_attempts || 0,
            max_return_attempts: r.max_return_attempts || EXTERNAL_BRIDGE_LIMITS.maxReturnAttempts,
            remaining_return_attempts: Math.max(0, (r.max_return_attempts || EXTERNAL_BRIDGE_LIMITS.maxReturnAttempts) - (r.return_attempts || 0)),
            last_error: r.last_error || null,
            revoked: Boolean(r.revoked_at),
            discarded,
            expired,
            stale,
            status: r.revoked_at
              ? 'revoked'
              : stale
                ? 'conflict'
                : expired
                  ? 'expired'
                  : discarded
                    ? 'discarded'
                    : activeCandidateId
                      ? 'returned_candidate'
                      : 'checked_out',
            created_at: r.created_at,
            expires_at: r.expires_at,
          }
        })

      let grantState = null
      if (grantId && project && manifest && GRANT_ID_RE.test(grantId)) {
        try {
          const verified = await verifyExternalBridgeGrant(scope, project, manifest, { grantId, requireToken: false, now })
          grantState = {
            grant_id: verified.grant_id,
            status: 'active',
            allowed_rect: verified.rect,
            allowed_operations: verified.allowed_operations,
            expires_at: verified.expires_at || null,
          }
        } catch (error) {
          grantState = {
            grant_id: grantId,
            status: error?.code === 'pixel_tool_grant_revoked'
              ? 'revoked'
              : error?.code === 'pixel_tool_session_expired'
                ? 'expired'
                : error?.code === 'pixel_tool_context_changed'
                  ? 'conflict'
                  : 'invalid',
            error: error?.code || 'pixel_tool_unauthorized',
            message: error?.message || 'Grant is no longer active.',
          }
        }
      }

      const readyCandidates = canvasSessions.filter(s => s.sealed && s.status === 'review_ready')
      return {
        compatibility: EXTERNAL_BRIDGE_COMPATIBILITY,
        limits: {
          max_live_checkouts: EXTERNAL_BRIDGE_LIMITS.maxLiveCheckouts,
          live_checkouts: storage.liveCheckouts.length,
          max_return_attempts: EXTERNAL_BRIDGE_LIMITS.maxReturnAttempts,
          checkout_ttl_ms: ttlMs,
        },
        target: {
          canvas_id: activeCanvasId,
          document_id: canvas?.document_id || null,
          project_revision: project?.revision || null,
          working_revision: manifest?.revision || null,
          supported: targetCheck.supported,
          reason: targetCheck.reason,
          message: targetCheck.message,
          ...(targetCheck.supported ? {
            frame_id: targetCheck.target.frame_id,
            layer_id: targetCheck.target.layer_id,
            cel_id: targetCheck.target.cel_id,
            layer_name: targetCheck.layer_name,
            duration_ms: targetCheck.duration_ms,
            tags: targetCheck.tags,
            source_sha256: rgba ? sha256Hex(rgba) : null,
          } : {}),
        },
        aseprite: {
          available: asepriteProbe.available,
          reason: asepriteProbe.reason,
          version: asepriteProbe.version,
        },
        codex_mcp: {
          available: true,
          transport: 'stdio',
          script: DEFAULT_MCP_STDIO_SCRIPT_PATH,
          cwd: scope.projectRoot,
        },
        grant: grantState,
        sessions: canvasSessions,
        checkouts: canvasCheckouts,
        latest_candidate: readyCandidates[0] || null,
      }
    },

    async connect(scope, body, { origin = 'http://127.0.0.1:4173' } = {}) {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw bridgeError('invalid_pixel_tool_request', 'Invalid connect request.', 400)
      }
      const {
        operation_id: operationId,
        canvas_id: canvasId,
        expected_revision: expectedRevision,
        expected_working_revision: expectedWorkingRevision,
        rect,
        allowed_operations: allowedOperations,
      } = body
      if (!UUID_RE.test(operationId || '') || typeof canvasId !== 'string' || !canvasId
        || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1
        || !Number.isSafeInteger(expectedWorkingRevision) || expectedWorkingRevision < 1) {
        throw bridgeError('invalid_pixel_tool_request', 'Invalid connect parameters.', 400)
      }
      return withBridgeLock(scope, async () => {
        const { project, canvas, manifest, rgba, targetCheck } = await loadTargetContext(scope, canvasId)
        if (!canvas || !manifest) throw bridgeError('pixel_tool_context_changed', 'Selected canvas was not found.', 409)
        if (!targetCheck.supported) {
          throw bridgeError('pixel_tool_target_unsupported', targetCheck.message, 422, { reason: targetCheck.reason })
        }
        const sourceSha256 = sha256Hex(rgba)
        const targetRect = rect ?? {
          x: 0,
          y: 0,
          w: EXTERNAL_BRIDGE_COMPATIBILITY.width,
          h: EXTERNAL_BRIDGE_COMPATIBILITY.height,
        }
        let issued
        try {
          issued = await issueExternalBridgeGrant(
            scope,
            project,
            manifest,
            {
              operation_id: operationId,
              canvas_id: canvasId,
              expected_revision: expectedRevision,
              expected_working_revision: expectedWorkingRevision,
              frame_id: targetCheck.target.frame_id,
              layer_id: targetCheck.target.layer_id,
              cel_id: targetCheck.target.cel_id,
              rect: targetRect,
              allowed_operations: allowedOperations ?? [...EXTERNAL_BRIDGE_OPERATIONS],
              source_sha256: sourceSha256,
            },
            { now, ttlMs },
          )
        } catch (error) {
          if (error?.code === 'operation_conflict') {
            throw bridgeError('pixel_tool_operation_conflict', error.message, 409)
          }
          if (error?.code === 'stale_revision' || error?.code === 'pixel_tool_context_changed') {
            throw bridgeError('pixel_tool_context_changed', 'The canvas changed before connecting external tools.', 409)
          }
          if (error?.code === 'pixel_tool_grant_revoked' || error?.code === 'pixel_tool_session_expired') {
            throw error
          }
          throw bridgeError(error?.code || 'invalid_pixel_tool_request', error?.message || 'Failed to issue external tool grant.', error?.http_status || 400)
        }
        const asepriteProbe = await probeAsepriteExecutable({ executablePath: asepriteExecutable, execImpl })
        const mcpCommand = buildTaskScopedCodexMcpCommand({
          url: origin,
          projectId: scope.projectId,
          canvasId,
          expectedRevision,
          expectedWorkingRevision,
          grantId: issued.grant.grant_id,
          bridgeToken: issued.bridge_token,
        })
        return {
          grant_id: issued.grant.grant_id,
          bridge_token: issued.bridge_token,
          replayed: issued.replayed,
          project_id: scope.projectId,
          canvas_id: canvasId,
          document_id: manifest.document_id,
          project_revision: project.revision,
          working_revision: manifest.revision,
          target: targetCheck.target,
          allowed_rect: issued.grant.rect,
          allowed_operations: issued.grant.allowed_operations,
          source_sha256: sourceSha256,
          created_at: issued.grant.created_at,
          expires_at: issued.grant.expires_at,
          compatibility: EXTERNAL_BRIDGE_COMPATIBILITY,
          codex_mcp: {
            transport: 'stdio',
            script: DEFAULT_MCP_STDIO_SCRIPT_PATH,
            cwd: scope.projectRoot,
            command: mcpCommand,
            command_line: formatTaskScopedCodexMcpCommandLine(mcpCommand),
          },
          aseprite: {
            available: asepriteProbe.available,
            version: asepriteProbe.version,
            reason: asepriteProbe.reason,
          },
        }
      })
    },

    async revoke(scope, body) {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw bridgeError('invalid_pixel_tool_request', 'Invalid revoke request.', 400)
      }
      const {
        grant_id: grantId,
        checkout_id: checkoutId,
        session_id: sessionId,
        discard_only: discardOnly = false,
      } = body

      return withBridgeLock(scope, async () => {
        const nowMs = now()
        const nowIso = new Date(nowMs).toISOString()
        const { controlledRootPath } = resolveBridgeRootPaths(scope)

        if (discardOnly) {
          if (sessionId !== undefined && (typeof sessionId !== 'string' || !UUID_RE.test(sessionId))) {
            throw bridgeError('invalid_pixel_tool_request', 'Invalid session_id for discard.', 400)
          }
          if (checkoutId !== undefined && (typeof checkoutId !== 'string' || !CHECKOUT_ID_RE.test(checkoutId))) {
            throw bridgeError('invalid_pixel_tool_request', 'Invalid checkout_id for discard.', 400)
          }
          if (!sessionId && !checkoutId) {
            throw bridgeError('invalid_pixel_tool_request', 'Either session_id or checkout_id is required for discard.', 400)
          }
          const sessionIdsToDiscard = new Set()
          if (sessionId) sessionIdsToDiscard.add(sessionId)
          const storage = await inspectBridgeStorage(scope, nowMs)
          const matchingReceipts = storage.allCheckouts.filter(receipt =>
            (checkoutId && receipt.checkout_id === checkoutId)
            || (sessionId && receipt.candidate_session_id === sessionId))
          for (const receipt of matchingReceipts) {
            if (receipt.candidate_session_id && UUID_RE.test(receipt.candidate_session_id)) {
              sessionIdsToDiscard.add(receipt.candidate_session_id)
            }
          }
          // Candidate authority ends before fallible receipt/diagnostic bookkeeping.
          // A retry repairs the sidecars without making the candidate reviewable again.
          let invalidatedSessions = 0
          for (const sid of sessionIdsToDiscard) {
            if (sessions.discardSession(scope, sid)) invalidatedSessions++
          }
          let invalidatedCheckouts = 0
          for (const receipt of matchingReceipts) {
            const checkoutPaths = resolveBridgeRootPaths(scope, receipt.checkout_id)
            const updatedReceipt = {
              ...receipt,
              discarded_at: receipt.discarded_at || nowIso,
              closed_at: receipt.closed_at || nowIso,
            }
            await writeBoundedJsonSidecar(controlledRootPath, checkoutPaths.receiptPath, updatedReceipt)
            await writeBoundedJsonSidecar(controlledRootPath, checkoutPaths.diagnosticPath, {
              checkout_id: receipt.checkout_id,
              grant_id: receipt.grant_id,
              status: 'discarded',
              discarded_at: updatedReceipt.discarded_at,
              return_attempts: receipt.return_attempts || 0,
            })
            invalidatedCheckouts++
          }
          return {
            discarded: true,
            session_id: sessionId || ([...sessionIdsToDiscard][0] ?? null),
            checkout_id: checkoutId || null,
            invalidated_sessions: invalidatedSessions,
            invalidated_checkouts: invalidatedCheckouts,
          }
        }

        if (typeof grantId !== 'string' || !GRANT_ID_RE.test(grantId)) {
          throw bridgeError('invalid_pixel_tool_request', 'A valid grant_id is required.', 400)
        }
        const revoked = await revokePixelScopeGrant(scope, grantId, { now })
        const invalidatedSessions = sessions.revokeGrant(scope, grantId)
        const storage = await inspectBridgeStorage(scope, nowMs)
        let invalidatedCheckouts = 0
        for (const receipt of storage.allCheckouts) {
          if (receipt.grant_id !== grantId || receipt.revoked_at) continue
          const checkoutPaths = resolveBridgeRootPaths(scope, receipt.checkout_id)
          const updatedReceipt = {
            ...receipt,
            revoked_at: revoked.revoked_at,
            closed_at: receipt.closed_at || revoked.revoked_at,
          }
          await writeBoundedJsonSidecar(controlledRootPath, checkoutPaths.receiptPath, updatedReceipt)
          await writeBoundedJsonSidecar(controlledRootPath, checkoutPaths.diagnosticPath, {
            checkout_id: receipt.checkout_id,
            grant_id: grantId,
            status: 'revoked',
            revoked_at: revoked.revoked_at,
            return_attempts: receipt.return_attempts || 0,
          })
          invalidatedCheckouts++
        }
        return {
          ...revoked,
          invalidated_sessions: invalidatedSessions,
          invalidated_checkouts: invalidatedCheckouts,
        }
      })
    },

    async createAsepriteCheckout(scope, body) {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw bridgeError('invalid_pixel_tool_request', 'Invalid checkout request.', 400)
      }
      const {
        operation_id: operationId,
        grant_id: grantId,
        bridge_token: bridgeToken,
        canvas_id: canvasId,
        expected_revision: expectedRevision,
        expected_working_revision: expectedWorkingRevision,
      } = body
      if (!UUID_RE.test(operationId || '') || !GRANT_ID_RE.test(grantId || '')
        || typeof canvasId !== 'string' || !canvasId
        || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1
        || !Number.isSafeInteger(expectedWorkingRevision) || expectedWorkingRevision < 1) {
        throw bridgeError('invalid_pixel_tool_request', 'Invalid checkout parameters.', 400)
      }

      return withBridgeLock(scope, async () => {
        const nowMs = now()
        const checkoutId = `chk_${operationId.replaceAll('-', '')}`
        const paths = resolveBridgeRootPaths(scope, checkoutId)
        const fingerprint = jsonHash({
          operation_id: operationId,
          grant_id: grantId,
          canvas_id: canvasId,
          expected_revision: expectedRevision,
          expected_working_revision: expectedWorkingRevision,
        })

        const existing = await readCheckoutReceipt(paths, { allowMissing: true })
        if (existing) {
          if (existing.request_fingerprint !== fingerprint) {
            throw bridgeError('pixel_tool_operation_conflict', 'Checkout operation_id was reused with different parameters.', 409)
          }
          if (existing.revoked_at) {
            throw bridgeError('pixel_tool_grant_revoked', 'The external tool grant was revoked.', 403)
          }
          if (existing.discarded_at || existing.closed_at) {
            throw bridgeError('pixel_tool_session_expired', 'The external edit copy was already closed or discarded.', 409)
          }
          const expiresMs = Date.parse(existing.expires_at || '')
          if (!Number.isFinite(expiresMs) || nowMs > expiresMs) {
            throw bridgeError('pixel_tool_session_expired', 'The external edit copy has expired (15-minute limit).', 409)
          }
          const { project, canvas, manifest } = await loadTargetContext(scope, canvasId)
          if (!canvas || !manifest || project.revision !== existing.project_revision || manifest.revision !== existing.working_revision) {
            throw bridgeError('pixel_tool_context_changed', 'The canvas changed since the external edit copy was created.', 409)
          }
          await verifyExternalBridgeGrant(scope, project, manifest, {
            grantId,
            bridgeToken,
            requiredOperation: 'external_file_import',
            now,
          })
          const workingFile = await readBoundedFileWithIdentity(
            paths.controlledRootPath,
            paths.checkoutDir,
            paths.workingCopyPath,
            EXTERNAL_BRIDGE_LIMITS.maxAsepriteFileBytes,
          )
          if (!workingFile) {
            throw bridgeError('aseprite_return_invalid', 'Checkout working copy file is missing.', 422, { rule: 'artifact_not_found' })
          }
          return { ...existing, replayed: true }
        }

        const { project, canvas, manifest, rgba, targetCheck } = await loadTargetContext(scope, canvasId)
        if (!canvas || !manifest) throw bridgeError('pixel_tool_context_changed', 'Selected canvas was not found.', 409)
        if (project.revision !== expectedRevision || manifest.revision !== expectedWorkingRevision) {
          throw bridgeError('pixel_tool_context_changed', 'The canvas changed before creating the external edit copy.', 409)
        }
        if (!targetCheck.supported) {
          throw bridgeError('pixel_tool_target_unsupported', targetCheck.message, 422, { reason: targetCheck.reason })
        }
        const grant = await verifyExternalBridgeGrant(scope, project, manifest, {
          grantId,
          bridgeToken,
          requiredOperation: 'external_file_import',
          now,
        })
        const sourceSha256 = sha256Hex(rgba)
        if (grant.source_sha256 && grant.source_sha256 !== sourceSha256) {
          throw bridgeError('pixel_tool_context_changed', 'The source pixels changed since the grant was issued.', 409)
        }

        const storage = await inspectBridgeStorage(scope, nowMs)
        if (storage.liveCheckouts.length >= EXTERNAL_BRIDGE_LIMITS.maxLiveCheckouts) {
          throw bridgeError('aseprite_checkout_limit', `At most ${EXTERNAL_BRIDGE_LIMITS.maxLiveCheckouts} active external edit copies are allowed.`, 429)
        }
        const reservedCheckoutBytes = rgba.length + 2 * EXTERNAL_BRIDGE_LIMITS.maxSidecarBytes + 32 * 1024
        if (storage.totalBytes + reservedCheckoutBytes > maxTotalCheckoutStorageBytes) {
          throw bridgeError('aseprite_storage_limit', 'External checkout storage limit (128 MiB) reached.', 429)
        }

        const probe = await probeAsepriteExecutable({ executablePath: asepriteExecutable, execImpl })
        if (!probe.available) {
          throw bridgeError('aseprite_unavailable', 'Aseprite 1.3 CLI is not available at the approved executable path.', 422, {
            reason: probe.reason,
          })
        }

        await mkdir(paths.bridgeRoot, { recursive: true })
        await ensureTrustedContainedDirectory({
          controlledRootPath: paths.controlledRootPath,
          directoryPath: paths.bridgeRoot,
          errorCode: 'runtime_storage_failed',
        })
        await mkdir(paths.checkoutDir)
        const realCheckoutDir = await ensureTrustedContainedDirectory({
          controlledRootPath: paths.controlledRootPath,
          directoryPath: paths.checkoutDir,
          errorCode: 'runtime_storage_failed',
        })
        const realWorkingCopyPath = path.join(realCheckoutDir.realPath, 'working-copy.aseprite')

        const createdIso = new Date(nowMs).toISOString()
        const expiresIso = new Date(nowMs + ttlMs).toISOString()
        await writeBoundedJsonSidecar(paths.controlledRootPath, paths.receiptPath, {
          version: 'aseprite_checkout_receipt_v1',
          checkout_id: checkoutId,
          operation_id: operationId,
          request_fingerprint: fingerprint,
          grant_id: grantId,
          status: 'creating',
          created_at: createdIso,
          expires_at: expiresIso,
        }, { exclusive: true })

        const rgbaHex = Buffer.from(rgba).toString('hex')
        const { stdout } = await execImpl(
          probe.executablePath,
          [
            '-b',
            '--script-param', 'mode=export',
            '--script-param', `width=${EXTERNAL_BRIDGE_COMPATIBILITY.width}`,
            '--script-param', `height=${EXTERNAL_BRIDGE_COMPATIBILITY.height}`,
            '--script-param', `duration_ms=${targetCheck.duration_ms}`,
            '--script-param', `layer_name=${targetCheck.layer_name}`,
            '--script-param', `tags_json=${JSON.stringify(targetCheck.tags)}`,
            '--script-param', `rgba_hex=${rgbaHex}`,
            '--script-param', `ase_path=${realWorkingCopyPath}`,
            '--script', BRIDGE_LUA_PATH,
          ],
          {
            timeout: EXTERNAL_BRIDGE_LIMITS.cliTimeoutMs,
            maxBuffer: 256 * 1024,
          },
        )
        parsePrefixedJson(stdout, 'EXPORT_JSON:')

        const aseFile = await readBoundedFileWithIdentity(
          paths.controlledRootPath,
          paths.checkoutDir,
          paths.workingCopyPath,
          EXTERNAL_BRIDGE_LIMITS.maxAsepriteFileBytes,
        )
        const headerCheck = inspectAsepriteBinaryHeader(aseFile?.bytes)
        if (!aseFile || !headerCheck.ok) {
          throw bridgeError('aseprite_export_failed', 'Generated working-copy.aseprite did not pass header verification.', 500)
        }
        if (storage.totalBytes + aseFile.size + rgba.length + 2 * EXTERNAL_BRIDGE_LIMITS.maxSidecarBytes > maxTotalCheckoutStorageBytes) {
          throw bridgeError('aseprite_storage_limit', 'External checkout storage limit (128 MiB) reached.', 429)
        }
        const checkoutFileSha256 = sha256Hex(aseFile.bytes)

        await writeTrustedRegularFile({
          controlledRootPath: paths.controlledRootPath,
          filePath: paths.sourceRgbaPath,
          bytes: Buffer.from(rgba),
          exclusive: true,
          errorCode: 'runtime_storage_failed',
        })

        const receipt = {
          version: 'aseprite_checkout_receipt_v1',
          checkout_id: checkoutId,
          operation_id: operationId,
          request_fingerprint: fingerprint,
          grant_id: grantId,
          status: 'checked_out',
          project_id: scope.projectId,
          canvas_id: canvasId,
          document_id: manifest.document_id,
          project_revision: project.revision,
          working_revision: manifest.revision,
          target: targetCheck.target,
          layer_name: targetCheck.layer_name,
          duration_ms: targetCheck.duration_ms,
          tags: targetCheck.tags,
          allowed_rect: grant.rect,
          compatibility: EXTERNAL_BRIDGE_COMPATIBILITY,
          working_copy_path: realWorkingCopyPath,
          source_sha256: sourceSha256,
          checkout_file_sha256: checkoutFileSha256,
          checkout_byte_length: aseFile.size,
          returned_file_sha256: null,
          candidate_session_id: null,
          review_path: null,
          return_attempts: 0,
          max_return_attempts: EXTERNAL_BRIDGE_LIMITS.maxReturnAttempts,
          active_return_operation_id: null,
          active_return_fingerprint: null,
          return_receipts: {},
          last_error: null,
          created_at: createdIso,
          expires_at: expiresIso,
          sealed_at: null,
          discarded_at: null,
          revoked_at: null,
          closed_at: null,
        }
        await writeBoundedJsonSidecar(paths.controlledRootPath, paths.receiptPath, receipt)
        await writeBoundedJsonSidecar(paths.controlledRootPath, paths.diagnosticPath, {
          checkout_id: checkoutId,
          grant_id: grantId,
          tool_version: probe.version,
          status: 'checked_out',
          checkout_file_sha256: checkoutFileSha256,
          source_sha256: sourceSha256,
          return_attempts: 0,
          created_at: createdIso,
          expires_at: expiresIso,
        }, { exclusive: true })
        return receipt
      })
    },

    async editAsepriteCheckout(scope, checkoutId, spec = {}) {
      const paths = resolveBridgeRootPaths(scope, checkoutId)
      await readCheckoutReceipt(paths, { allowMissing: false })
      const probe = await probeAsepriteExecutable({ executablePath: asepriteExecutable, execImpl })
      if (!probe.available) {
        throw bridgeError('aseprite_unavailable', 'Aseprite 1.3 CLI is not available.', 422, { reason: probe.reason })
      }
      const resolvedWorkingCopy = await resolveContainedRegularFile({
        controlledRootPath: paths.controlledRootPath,
        rootPath: paths.checkoutDir,
        candidatePath: paths.workingCopyPath,
        errorCode: 'runtime_storage_failed',
      })
      const { stdout } = await execImpl(
        probe.executablePath,
        [
          '-b',
          '--script-param', 'mode=batch_edit',
          '--script-param', `ase_path=${resolvedWorkingCopy}`,
          '--script-param', `ops_json=${JSON.stringify(spec)}`,
          '--script', BRIDGE_LUA_PATH,
        ],
        {
          timeout: EXTERNAL_BRIDGE_LIMITS.cliTimeoutMs,
          maxBuffer: 256 * 1024,
        },
      )
      parsePrefixedJson(stdout, 'BATCH_EDIT_JSON:')
      const editedBytes = await readBoundedFile(
        paths.controlledRootPath,
        paths.checkoutDir,
        paths.workingCopyPath,
        EXTERNAL_BRIDGE_LIMITS.maxAsepriteFileBytes,
      )
      return {
        checkout_id: checkoutId,
        edited_file_sha256: sha256Hex(editedBytes),
        byte_length: editedBytes.length,
      }
    },

    async returnAsepriteCheckout(scope, checkoutId, body) {
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw bridgeError('invalid_pixel_tool_request', 'Invalid return request.', 400)
      }
      const { operation_id: operationId, bridge_token: bridgeToken } = body
      if (!UUID_RE.test(operationId || '')) {
        throw bridgeError('invalid_pixel_tool_request', 'A valid operation_id is required.', 400)
      }
      const paths = resolveBridgeRootPaths(scope, checkoutId)
      const fingerprint = jsonHash({
        checkout_id: checkoutId,
        operation_id: operationId,
        bridge_token: bridgeToken || null,
        expected_revision: body.expected_revision ?? null,
        expected_working_revision: body.expected_working_revision ?? null,
      })

      // Phase 1: Under bridge lock, validate live authority/context, check idempotent receipts, reserve return attempt, and snapshot working-copy.aseprite.
      const phase1 = await withBridgeLock(scope, async () => {
        const receipt = await readCheckoutReceipt(paths, { allowMissing: false })
        const priorReceipt = receipt.return_receipts?.[operationId]
        if (priorReceipt && priorReceipt.fingerprint !== fingerprint) {
          throw bridgeError('pixel_tool_operation_conflict', 'Return operation_id was reused with different parameters.', 409)
        }
        if (receipt.active_return_operation_id === operationId && receipt.active_return_fingerprint !== fingerprint) {
          throw bridgeError('pixel_tool_operation_conflict', 'Return operation_id is currently active with different parameters.', 409)
        }

        const nowMs = now()
        const expiresMs = Date.parse(receipt.expires_at || '')
        if (receipt.revoked_at) {
          throw bridgeError('pixel_tool_grant_revoked', 'The external tool grant was revoked.', 403)
        }
        if (receipt.discarded_at || receipt.closed_at) {
          throw bridgeError('pixel_tool_session_expired', 'The external edit copy was already closed or discarded.', 409)
        }
        if (!Number.isFinite(expiresMs) || nowMs > expiresMs) {
          throw bridgeError('pixel_tool_session_expired', 'The external edit copy has expired (15-minute limit).', 409)
        }
        if ((body.expected_revision !== undefined && body.expected_revision !== receipt.project_revision)
          || (body.expected_working_revision !== undefined && body.expected_working_revision !== receipt.working_revision)) {
          throw bridgeError('pixel_tool_context_changed', 'The canvas revision does not match the external edit copy baseline.', 409)
        }

        const { project, canvas, manifest } = await loadTargetContext(scope, receipt.canvas_id)
        if (!canvas || !manifest || project.revision !== receipt.project_revision || manifest.revision !== receipt.working_revision) {
          throw bridgeError('pixel_tool_context_changed', 'The canvas changed since the external edit copy was created. No pixels were imported.', 409)
        }
        await verifyExternalBridgeGrant(scope, project, manifest, {
          grantId: receipt.grant_id,
          bridgeToken,
          requiredOperation: 'external_file_import',
          now,
        })

        if (priorReceipt) {
          if (priorReceipt.status === 'in_flight') {
            throw bridgeError('pixel_tool_busy', 'Return operation is already in progress.', 409)
          }
          if (priorReceipt.error) {
            throw bridgeError(priorReceipt.error, priorReceipt.message, priorReceipt.http_status || 422, priorReceipt.diagnostic || null)
          }
          const reviewed = await sessions.review(scope, priorReceipt.result.session_id)
          return {
            replayedResponse: {
              ...priorReceipt.result,
              replayed: true,
              context: reviewed.context,
              pixel_candidate: reviewed.pixel_candidate,
            },
          }
        }

        if (receipt.active_return_operation_id) {
          throw bridgeError('pixel_tool_busy', 'Another return operation is currently in progress for this external edit copy.', 409)
        }
        if (receipt.sealed_at || receipt.candidate_session_id) {
          throw bridgeError('pixel_tool_preview_sealed', 'This external edit copy has already staged a candidate for review.', 409)
        }

        const maxAttempts = receipt.max_return_attempts || EXTERNAL_BRIDGE_LIMITS.maxReturnAttempts
        if ((receipt.return_attempts || 0) >= maxAttempts) {
          throw bridgeError('aseprite_return_limit_exceeded', `Maximum return attempts (${maxAttempts}) reached for this external edit copy.`, 409)
        }

        const attemptNumber = (receipt.return_attempts || 0) + 1
        receipt.return_attempts = attemptNumber
        receipt.active_return_operation_id = operationId
        receipt.active_return_fingerprint = fingerprint
        receipt.return_receipts ||= {}
        receipt.return_receipts[operationId] = {
          fingerprint,
          status: 'in_flight',
          attempt: attemptNumber,
        }

        const failPhase1 = async (code, message, httpStatus = 422, diagnostic = null) => {
          const sanitizedDiag = diagnostic ? { ...diagnostic, attempt: attemptNumber } : { rule: code, attempt: attemptNumber }
          receipt.active_return_operation_id = null
          receipt.active_return_fingerprint = null
          receipt.last_error = { code, message, diagnostic: sanitizedDiag }
          receipt.return_receipts[operationId] = {
            fingerprint,
            error: code,
            message,
            http_status: httpStatus,
            diagnostic: sanitizedDiag,
          }
          await writeBoundedJsonSidecar(paths.controlledRootPath, paths.receiptPath, receipt)
          await writeBoundedJsonSidecar(paths.controlledRootPath, paths.diagnosticPath, {
            checkout_id: checkoutId,
            grant_id: receipt.grant_id,
            status: 'return_failed',
            return_attempts: attemptNumber,
            last_error: receipt.last_error,
          })
          throw bridgeError(code, message, httpStatus, sanitizedDiag)
        }

        let workingCopyFile
        try {
          workingCopyFile = await readBoundedFileWithIdentity(
            paths.controlledRootPath,
            paths.checkoutDir,
            paths.workingCopyPath,
            EXTERNAL_BRIDGE_LIMITS.maxAsepriteFileBytes,
          )
        } catch (error) {
          return failPhase1(
            error.code || 'aseprite_return_invalid',
            error.message || 'The working-copy.aseprite file could not be read safely.',
            error.http_status || 422,
            error.diagnostic || { rule: 'file_unreadable' },
          )
        }
        if (!workingCopyFile) {
          return failPhase1('aseprite_return_invalid', 'The .aseprite working copy is missing.', 422, { rule: 'file_truncated' })
        }

        const headerCheck = inspectAsepriteBinaryHeader(workingCopyFile.bytes)
        if (!headerCheck.ok) {
          return failPhase1('aseprite_return_invalid', headerCheck.message, 422, { rule: headerCheck.rule })
        }

        const sourceRgbaFile = await readBoundedFileWithIdentity(
          paths.controlledRootPath,
          paths.checkoutDir,
          paths.sourceRgbaPath,
          EXTERNAL_BRIDGE_LIMITS.maxDecodedRgbaBytes,
        )
        if (!sourceRgbaFile || sourceRgbaFile.size !== EXTERNAL_BRIDGE_COMPATIBILITY.rgbaByteLength
          || sha256Hex(sourceRgbaFile.bytes) !== receipt.source_sha256) {
          return failPhase1('aseprite_return_invalid', 'Checkout source baseline could not be verified.', 422, { rule: 'source_baseline_invalid' })
        }

        const storage = await inspectBridgeStorage(scope, nowMs)
        const requiredReturnStorageBytes = workingCopyFile.size + 2 * EXTERNAL_BRIDGE_LIMITS.maxSidecarBytes
        if (storage.totalBytes + requiredReturnStorageBytes > maxTotalCheckoutStorageBytes) {
          return failPhase1('aseprite_storage_limit', 'External checkout storage limit (128 MiB) reached.', 429, { rule: 'storage_limit' })
        }

        const snapshotFileName = `return-snapshot-${attemptNumber}.aseprite`
        const snapshotPath = path.join(paths.checkoutDir, snapshotFileName)
        await writeTrustedRegularFile({
          controlledRootPath: paths.controlledRootPath,
          filePath: snapshotPath,
          bytes: workingCopyFile.bytes,
          exclusive: true,
          errorCode: 'runtime_storage_failed',
        })
        const resolvedSnapshotPath = await resolveContainedRegularFile({
          controlledRootPath: paths.controlledRootPath,
          rootPath: paths.checkoutDir,
          candidatePath: snapshotPath,
          errorCode: 'runtime_storage_failed',
        })

        await writeBoundedJsonSidecar(paths.controlledRootPath, paths.receiptPath, receipt)

        return {
          attemptNumber,
          maxAttempts,
          snapshotPath: resolvedSnapshotPath,
          beforeWorkingCopy: {
            size: workingCopyFile.size,
            dev: workingCopyFile.dev,
            ino: workingCopyFile.ino,
            sha256: sha256Hex(workingCopyFile.bytes),
          },
          sourceRgbaBytes: sourceRgbaFile.bytes,
        }
      })

      if (phase1.replayedResponse) {
        return phase1.replayedResponse
      }

      // Phase 2: Inspect the immutable server-controlled snapshot with supervised Aseprite CLI.
      const probe = await probeAsepriteExecutable({ executablePath: asepriteExecutable, execImpl })
      let inspectOutcome
      if (!probe.available) {
        inspectOutcome = {
          ok: false,
          code: 'aseprite_unavailable',
          message: 'Aseprite 1.3 CLI is not available to validate the returned file.',
          httpStatus: 422,
          diagnostic: { rule: 'executable_unavailable' },
        }
      } else {
        try {
          const { stdout } = await execImpl(
            probe.executablePath,
            [
              '-b',
              '--script-param', 'mode=inspect',
              '--script-param', `ase_path=${phase1.snapshotPath}`,
              '--script-param', `expected_width=${EXTERNAL_BRIDGE_COMPATIBILITY.width}`,
              '--script-param', `expected_height=${EXTERNAL_BRIDGE_COMPATIBILITY.height}`,
              '--script', BRIDGE_LUA_PATH,
            ],
            {
              timeout: EXTERNAL_BRIDGE_LIMITS.cliTimeoutMs,
              maxRssMiB: EXTERNAL_BRIDGE_LIMITS.cliMaxRssMiB,
              maxBuffer: 512 * 1024,
            },
          )
          inspectOutcome = {
            ok: true,
            inspected: parsePrefixedJson(stdout, 'INSPECT_JSON:'),
          }
        } catch (error) {
          const isTimeout = error?.failure_kind === EXTERNAL_TOOL_FAILURE.TIMEOUT
          const isRss = error?.failure_kind === EXTERNAL_TOOL_FAILURE.RSS_LIMIT
          inspectOutcome = {
            ok: false,
            code: 'aseprite_return_invalid',
            message: isTimeout || isRss
              ? 'Aseprite validation exceeded resource or timeout limits.'
              : 'Aseprite could not parse the returned .aseprite working copy.',
            httpStatus: 422,
            diagnostic: {
              rule: isRss ? 'rss_limit' : isTimeout ? 'timeout' : 'parse_failed',
            },
          }
        }
      }

      // Phase 3: Under bridge lock, re-read receipt from disk, verify no intervening revocation/context/file changes, validate inspected structure, and stage candidate.
      return withBridgeLock(scope, async () => {
        const latestReceipt = await readCheckoutReceipt(paths, { allowMissing: false })
        const attemptNumber = phase1.attemptNumber
        const maxAttempts = phase1.maxAttempts
        latestReceipt.active_return_operation_id = null
        latestReceipt.active_return_fingerprint = null
        latestReceipt.return_receipts ||= {}

        const recordReturnFailure = async (code, message, httpStatus = 422, diagnostic = null) => {
          const sanitizedDiag = diagnostic ? { ...diagnostic, attempt: attemptNumber } : { rule: code, attempt: attemptNumber }
          latestReceipt.last_error = { code, message, diagnostic: sanitizedDiag }
          latestReceipt.return_receipts[operationId] = {
            fingerprint,
            error: code,
            message,
            http_status: httpStatus,
            diagnostic: sanitizedDiag,
          }
          await writeBoundedJsonSidecar(paths.controlledRootPath, paths.receiptPath, latestReceipt)
          await writeBoundedJsonSidecar(paths.controlledRootPath, paths.diagnosticPath, {
            checkout_id: checkoutId,
            grant_id: latestReceipt.grant_id,
            status: latestReceipt.revoked_at ? 'revoked' : 'return_failed',
            ...(latestReceipt.revoked_at ? { revoked_at: latestReceipt.revoked_at } : {}),
            return_attempts: latestReceipt.return_attempts,
            last_error: latestReceipt.last_error,
          })
          throw bridgeError(code, message, httpStatus, sanitizedDiag)
        }

        if (latestReceipt.revoked_at) {
          return recordReturnFailure('pixel_tool_grant_revoked', 'The external tool grant was revoked while validating the returned file.', 403, { rule: 'grant_revoked' })
        }
        if (latestReceipt.discarded_at || latestReceipt.closed_at) {
          return recordReturnFailure('pixel_tool_session_expired', 'The external edit copy was closed while validating the returned file.', 409, { rule: 'session_expired' })
        }
        const nowMs = now()
        const expiresMs = Date.parse(latestReceipt.expires_at || '')
        if (!Number.isFinite(expiresMs) || nowMs > expiresMs) {
          return recordReturnFailure('pixel_tool_session_expired', 'The external edit copy expired before return completed.', 409, { rule: 'session_expired' })
        }

        const { project, canvas, manifest } = await loadTargetContext(scope, latestReceipt.canvas_id)
        if (!canvas || !manifest || project.revision !== latestReceipt.project_revision || manifest.revision !== latestReceipt.working_revision) {
          return recordReturnFailure('pixel_tool_context_changed', 'The canvas changed while validating the returned file. No pixels were imported.', 409, { rule: 'context_changed' })
        }
        try {
          await verifyExternalBridgeGrant(scope, project, manifest, {
            grantId: latestReceipt.grant_id,
            bridgeToken,
            requiredOperation: 'external_file_import',
            now,
          })
        } catch (error) {
          return recordReturnFailure(
            error?.code || 'pixel_tool_unauthorized',
            error?.message || 'Grant is no longer active.',
            error?.http_status || 403,
            { rule: error?.code || 'grant_invalid' },
          )
        }

        let afterWorkingCopy
        try {
          afterWorkingCopy = await readBoundedFileWithIdentity(
            paths.controlledRootPath,
            paths.checkoutDir,
            paths.workingCopyPath,
            EXTERNAL_BRIDGE_LIMITS.maxAsepriteFileBytes,
          )
        } catch (error) {
          return recordReturnFailure(
            error.code || 'aseprite_return_invalid',
            error.message || 'The working-copy.aseprite file became unsafe during return.',
            error.http_status || 422,
            error.diagnostic || { rule: 'unsafe_path' },
          )
        }
        if (!afterWorkingCopy
          || afterWorkingCopy.dev !== phase1.beforeWorkingCopy.dev
          || afterWorkingCopy.ino !== phase1.beforeWorkingCopy.ino
          || afterWorkingCopy.size !== phase1.beforeWorkingCopy.size
          || sha256Hex(afterWorkingCopy.bytes) !== phase1.beforeWorkingCopy.sha256) {
          return recordReturnFailure(
            'aseprite_return_invalid',
            'The working-copy.aseprite file was modified or replaced while return validation was in progress.',
            422,
            { rule: 'file_changed_during_return' },
          )
        }

        if (!inspectOutcome.ok) {
          return recordReturnFailure(inspectOutcome.code, inspectOutcome.message, inspectOutcome.httpStatus, inspectOutcome.diagnostic)
        }

        const inspected = inspectOutcome.inspected
        if (!inspected?.ok) {
          return recordReturnFailure('aseprite_return_invalid', 'Returned .aseprite file is invalid.', 422, { rule: inspected?.rule || 'invalid_file' })
        }
        if (inspected.width !== EXTERNAL_BRIDGE_COMPATIBILITY.width || inspected.height !== EXTERNAL_BRIDGE_COMPATIBILITY.height) {
          return recordReturnFailure(
            'aseprite_return_invalid',
            `Returned sprite dimensions (${inspected.width}×${inspected.height}) do not match ${EXTERNAL_BRIDGE_COMPATIBILITY.width}×${EXTERNAL_BRIDGE_COMPATIBILITY.height}.`,
            422,
            { rule: 'canvas_dimensions' },
          )
        }
        if (inspected.colorMode !== 0) {
          return recordReturnFailure('aseprite_return_invalid', 'Returned sprite must remain in RGB color mode.', 422, { rule: 'color_mode' })
        }
        if (inspected.frameCount !== EXTERNAL_BRIDGE_COMPATIBILITY.maxFrames) {
          return recordReturnFailure('aseprite_return_invalid', 'Adding or deleting frames is not supported in external edit return.', 422, { rule: 'frame_count' })
        }
        if (inspected.layerCount !== EXTERNAL_BRIDGE_COMPATIBILITY.maxLayers || !inspected.layer) {
          return recordReturnFailure('aseprite_return_invalid', 'Adding, deleting, or grouping layers is not supported in external edit return.', 422, { rule: 'layer_count' })
        }
        const l = inspected.layer
        if (!l.isImage || l.isGroup || l.isTilemap || l.isBackground || l.isReference || !l.isVisible || !l.isEditable
          || l.isContinuous || l.blendMode !== 3 || l.opacity !== 255 || l.data !== '' || l.name !== latestReceipt.layer_name
          || l.colorAlpha !== 0 || l.colorRed !== 0 || l.colorGreen !== 0 || l.colorBlue !== 0) {
          return recordReturnFailure('aseprite_return_invalid', 'Returned layer structure, blend mode, opacity, lock, color, or visibility was modified incompatibly.', 422, { rule: 'layer_structure' })
        }
        if (inspected.celCount !== 1 || !inspected.cel) {
          return recordReturnFailure('aseprite_return_invalid', 'Returned sprite must contain exactly one cel on the target layer and frame.', 422, { rule: 'cel_structure' })
        }
        const c = inspected.cel
        if (c.frameNumber !== 1 || c.opacity !== 255 || c.zIndex !== 0 || c.data !== ''
          || c.colorAlpha !== 0 || c.colorRed !== 0 || c.colorGreen !== 0 || c.colorBlue !== 0
          || c.x < 0 || c.y < 0 || (c.x + c.width) > EXTERNAL_BRIDGE_COMPATIBILITY.width || (c.y + c.height) > EXTERNAL_BRIDGE_COMPATIBILITY.height) {
          return recordReturnFailure('aseprite_return_invalid', 'Returned cel bounds, opacity, or metadata are outside the supported compatibility boundary.', 422, { rule: 'cel_structure' })
        }
        if (inspected.sliceCount !== 0 || inspected.spriteData !== '' || inspected.pixelRatioW !== 1 || inspected.pixelRatioH !== 1
          || inspected.durationMs !== latestReceipt.duration_ms) {
          return recordReturnFailure('aseprite_return_invalid', 'Returned sprite modified unsupported metadata (slices, user data, pixel ratio, or frame duration).', 422, { rule: 'unsupported_metadata' })
        }
        const expectedTags = latestReceipt.tags || []
        const returnedTags = Array.isArray(inspected.tags) ? inspected.tags : []
        if (returnedTags.length !== expectedTags.length) {
          return recordReturnFailure('aseprite_return_invalid', 'Returned sprite added or removed timeline tags.', 422, { rule: 'unsupported_metadata' })
        }
        for (let i = 0; i < expectedTags.length; i++) {
          const exp = expectedTags[i]
          const got = returnedTags[i]
          const hasCustomTagColor = got && (got.colorRed !== 0 || got.colorGreen !== 0 || got.colorBlue !== 0 || (got.colorAlpha !== 0 && got.colorAlpha !== 255))
          if (!got || got.name !== exp.name || got.direction !== exp.direction || got.fromFrame !== 1 || got.toFrame !== 1
            || got.repeats !== 0 || got.data !== '' || hasCustomTagColor) {
            return recordReturnFailure('aseprite_return_invalid', 'Returned sprite modified tag metadata outside single-frame compatibility.', 422, { rule: 'unsupported_metadata' })
          }
        }

        if (typeof inspected.rgba_hex !== 'string' || inspected.rgba_hex.length !== EXTERNAL_BRIDGE_COMPATIBILITY.rgbaByteLength * 2) {
          return recordReturnFailure('aseprite_return_invalid', 'Decoded RGBA buffer size does not match 64×64×4 bytes.', 422, { rule: 'decoded_rgba_length' })
        }
        const returnedRgba = new Uint8Array(Buffer.from(inspected.rgba_hex, 'hex'))
        for (let i = 3; i < returnedRgba.length; i += 4) {
          if (returnedRgba[i] !== 0 && returnedRgba[i] !== 255) {
            return recordReturnFailure('aseprite_return_invalid', 'Returned sprite contains semitransparent pixels; only binary alpha (0 or 255) is supported.', 422, { rule: 'binary_alpha' })
          }
        }

        const sourceRgbaBytes = phase1.sourceRgbaBytes
        const rect = latestReceipt.allowed_rect
        const w = EXTERNAL_BRIDGE_COMPATIBILITY.width
        const h = EXTERNAL_BRIDGE_COMPATIBILITY.height
        let changedPixels = 0
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4
            const inside = x >= rect.x && x < (rect.x + rect.w) && y >= rect.y && y < (rect.y + rect.h)
            const same = returnedRgba[idx] === sourceRgbaBytes[idx]
              && returnedRgba[idx + 1] === sourceRgbaBytes[idx + 1]
              && returnedRgba[idx + 2] === sourceRgbaBytes[idx + 2]
              && returnedRgba[idx + 3] === sourceRgbaBytes[idx + 3]
            if (!inside && !same) {
              return recordReturnFailure(
                'aseprite_return_invalid',
                'Returned sprite modified pixels outside the authorized selection rectangle.',
                422,
                { rule: 'outside_allowed_rect', x, y },
              )
            }
            if (inside && !same) changedPixels++
          }
        }

        const returnedFileSha256 = phase1.beforeWorkingCopy.sha256
        let staged
        try {
          staged = await sessions.stageExternalCandidate(scope, {
            operation_id: operationId,
            grant_id: latestReceipt.grant_id,
            canvas_id: latestReceipt.canvas_id,
            expected_revision: latestReceipt.project_revision,
            expected_working_revision: latestReceipt.working_revision,
            target: latestReceipt.target,
            allowed_rect: latestReceipt.allowed_rect,
            rgba: returnedRgba,
            source_rgba: new Uint8Array(sourceRgbaBytes),
            bridge_source: 'aseprite',
          })
        } catch (error) {
          return recordReturnFailure(
            error?.code || 'pixel_tool_session_limit',
            error?.message || 'Could not stage returned external candidate.',
            error?.http_status || 429,
            error?.diagnostic || { rule: error?.code || 'stage_failed' },
          )
        }

        const result = {
          checkout_id: checkoutId,
          grant_id: latestReceipt.grant_id,
          session_id: staged.session_id,
          review_path: staged.review_path,
          checkout_file_sha256: latestReceipt.checkout_file_sha256,
          returned_file_sha256: returnedFileSha256,
          file_modified: returnedFileSha256 !== latestReceipt.checkout_file_sha256,
          source_sha256: latestReceipt.source_sha256,
          candidate_sha256: staged.pixel_candidate.sha256,
          changed_pixels: changedPixels,
          return_attempts: latestReceipt.return_attempts,
          remaining_return_attempts: Math.max(0, maxAttempts - latestReceipt.return_attempts),
          context: staged.context,
          pixel_candidate: staged.pixel_candidate,
          saved: false,
        }

        latestReceipt.status = 'returned_candidate'
        latestReceipt.returned_file_sha256 = returnedFileSha256
        latestReceipt.candidate_session_id = staged.session_id
        latestReceipt.review_path = staged.review_path
        latestReceipt.sealed_at = new Date(nowMs).toISOString()
        latestReceipt.last_error = null
        latestReceipt.return_receipts[operationId] = {
          fingerprint,
          result: {
            checkout_id: checkoutId,
            grant_id: latestReceipt.grant_id,
            session_id: staged.session_id,
            review_path: staged.review_path,
            checkout_file_sha256: latestReceipt.checkout_file_sha256,
            returned_file_sha256: returnedFileSha256,
            file_modified: returnedFileSha256 !== latestReceipt.checkout_file_sha256,
            source_sha256: latestReceipt.source_sha256,
            candidate_sha256: staged.pixel_candidate.sha256,
            changed_pixels: changedPixels,
            return_attempts: latestReceipt.return_attempts,
            remaining_return_attempts: Math.max(0, maxAttempts - latestReceipt.return_attempts),
            saved: false,
          },
        }
        await writeBoundedJsonSidecar(paths.controlledRootPath, paths.receiptPath, latestReceipt)
        await writeBoundedJsonSidecar(paths.controlledRootPath, paths.diagnosticPath, {
          checkout_id: checkoutId,
          grant_id: latestReceipt.grant_id,
          status: 'returned_candidate',
          checkout_file_sha256: latestReceipt.checkout_file_sha256,
          returned_file_sha256: returnedFileSha256,
          source_sha256: latestReceipt.source_sha256,
          candidate_sha256: staged.pixel_candidate.sha256,
          changed_pixels: changedPixels,
          candidate_session_id: staged.session_id,
          return_attempts: latestReceipt.return_attempts,
        })

        return result
      })
    },
  }
}

export const externalBridgeService = createExternalBridgeService()
