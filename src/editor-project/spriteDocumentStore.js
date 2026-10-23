import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { deflateSync, inflateSync } from 'node:zlib'
import sharp from 'sharp'

import { classifySequenceImage, GENERAL_SEQUENCE_MAX_FRAMES } from './generalSequenceBody.js'
import { prepareGeneralSequence } from '../character-pack/generalAssetFrames.js'
import { createAssetRef, createAssetRevision } from './assets.js'
import { createDefaultEditorProjectV1 } from './defaults.js'
import {
  EDITOR_PROJECT_V1_VERSION,
  SPRITE_DOCUMENT_LIMITS,
  SPRITE_DOCUMENT_VERSION,
} from './constants.js'
import {
  ensureTrustedContainedDirectory,
  fsyncTrustedDirectory,
  projectRelativePath,
  resolveEditorProjectPaths,
  resolveManagedAssetRevisionPaths,
  resolveManagedRevisionArtifactFile,
  resolveSpriteDocumentPaths,
  spriteDocumentBlockPath,
  spriteDocumentRevisionPath,
  writeTrustedRegularFile,
} from './paths.js'
import { loadEditorProject, withEditorProjectMutationLock } from './projectStore.js'
import { createPixelWorkingCopy, modifyPixelWorkingCopy } from './pixelWorkingCopy.js'
import { pixelDocumentTarget } from './pixelDocumentTarget.js'
import { isBlankSpriteDocument, isGeneralSequenceSpriteDocument, isEditablePixelDocument } from './pixelDocumentOrigin.js'
import { assertPixelStructure as validatePixelStructure, applyStructureCommand as mutatePixelStructure, compositePixelFrame, PIXEL_STRUCTURE_FIELDS, transformCanvasRgba } from './pixelStructure.js'
import { assertScopedDocumentCandidate } from './documentToolSession.js'
import { pixelLinkScope } from './pixelLinks.js'
import { issuePixelScopeGrant, checkScopedPixelWrite } from './pixelScopeGrants.js'
import { clonePlain, isPositiveInteger, isSafeRelativePath, isValidId } from './safety.js'
import { parseEditorProjectJson, serializeEditorProject } from './serializer.js'
import { lookupProjectReceipt, lookupProjectRevision, prepareHistoryProject, stageProjectReceipt } from './projectHistoryStore.js'
import {
  DEFAULT_V1_DOCUMENT_NAME,
  DEFAULT_V1_PROJECT_NAME,
  SpriteDocumentError,
  assertDocumentLimits,
  assertJsonByteLimit,
  assertValidSpriteDocument,
  deriveStableId,
  durationFromFps,
  isPixelEditorProject,
  isSha256Hex,
  payloadSha256,
  parseProjectPaletteRequest,
  sha256Bytes,
  spriteDocumentError,
} from './spriteDocumentValidation.js'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const CRC_TABLE = new Uint32Array(256)
for (let index = 0; index < 256; index += 1) {
  let crc = index
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  CRC_TABLE[index] = crc >>> 0
}

const pixelCache = new Map()
let pixelCacheBytes = 0

export function resetSpritePixelCache() {
  pixelCache.clear()
  pixelCacheBytes = 0
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const value of bytes) crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function writeChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const crcBytes = Buffer.concat([typeBytes, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcBytes))
  return Buffer.concat([length, typeBytes, data, crc])
}

export function encodeRgbaPng(width, height, rgba) {
  if (!isPositiveInteger(width) || !isPositiveInteger(height) || !Buffer.isBuffer(rgba)) {
    throw spriteDocumentError('invalid_request', 'RGBA PNG dimensions are invalid')
  }
  if (rgba.length !== width * height * 4) {
    throw spriteDocumentError('invalid_request', 'RGBA buffer length does not match canvas')
  }
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    PNG_SIGNATURE,
    writeChunk('IHDR', ihdr),
    writeChunk('IDAT', deflateSync(raw)),
    writeChunk('IEND', Buffer.alloc(0)),
  ])
}

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upLeftDistance = Math.abs(estimate - upLeft)
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left
  if (upDistance <= upLeftDistance) return up
  return upLeft
}

function unfilter(raw, width, height, bytesPerPixel) {
  const stride = width * bytesPerPixel
  const output = Buffer.alloc(stride * height)
  let source = 0
  for (let y = 0; y < height; y += 1) {
    const filter = raw[source]
    source += 1
    const row = raw.subarray(source, source + stride)
    source += stride
    const destOffset = y * stride
    const prevOffset = (y - 1) * stride
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? output[destOffset + x - bytesPerPixel] : 0
      const up = y > 0 ? output[prevOffset + x] : 0
      const upLeft = y > 0 && x >= bytesPerPixel ? output[prevOffset + x - bytesPerPixel] : 0
      let value = row[x]
      if (filter === 1) value = (value + left) & 255
      else if (filter === 2) value = (value + up) & 255
      else if (filter === 3) value = (value + Math.floor((left + up) / 2)) & 255
      else if (filter === 4) value = (value + paethPredictor(left, up, upLeft)) & 255
      else if (filter !== 0) {
        throw spriteDocumentError('unsupported_input', 'PNG filter is unsupported')
      }
      output[destOffset + x] = value
    }
  }
  return output
}

function expandToRgba(pixels, width, height, colorType, palette, transparency) {
  const count = width * height
  const rgba = Buffer.alloc(count * 4)
  if (colorType === 6) {
    pixels.copy(rgba)
    return rgba
  }
  for (let index = 0; index < count; index += 1) {
    const dest = index * 4
    if (colorType === 2) {
      const source = index * 3
      rgba[dest] = pixels[source]
      rgba[dest + 1] = pixels[source + 1]
      rgba[dest + 2] = pixels[source + 2]
      rgba[dest + 3] = 255
      if (transparency && transparency.length >= 6
        && pixels[source] === transparency[1] && pixels[source + 1] === transparency[3]
        && pixels[source + 2] === transparency[5]) {
        rgba[dest + 3] = 0
      }
    } else if (colorType === 0) {
      const gray = pixels[index]
      rgba[dest] = gray
      rgba[dest + 1] = gray
      rgba[dest + 2] = gray
      rgba[dest + 3] = transparency && transparency.length >= 2 && gray === transparency[1] ? 0 : 255
    } else if (colorType === 4) {
      const source = index * 2
      rgba[dest] = pixels[source]
      rgba[dest + 1] = pixels[source]
      rgba[dest + 2] = pixels[source]
      rgba[dest + 3] = pixels[source + 1]
    } else if (colorType === 3) {
      const paletteIndex = pixels[index]
      const entry = paletteIndex * 3
      if (!palette || entry + 2 >= palette.length) {
        throw spriteDocumentError('unsupported_input', 'PNG palette index is invalid')
      }
      rgba[dest] = palette[entry]
      rgba[dest + 1] = palette[entry + 1]
      rgba[dest + 2] = palette[entry + 2]
      rgba[dest + 3] = transparency && paletteIndex < transparency.length ? transparency[paletteIndex] : 255
    } else {
      throw spriteDocumentError('unsupported_input', 'PNG color type is unsupported')
    }
  }
  return rgba
}

function readPngChunks(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw spriteDocumentError('unsupported_input', 'source is not a PNG')
  }
  if (buffer.length > SPRITE_DOCUMENT_LIMITS.maxManagedPngBytes) {
    throw spriteDocumentError('resource_limit', 'managed PNG exceeds 32MiB', {
      limit: SPRITE_DOCUMENT_LIMITS.maxManagedPngBytes,
    })
  }
  let offset = 8
  const chunks = []
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    if (length > buffer.length - offset - 12) {
      throw spriteDocumentError('unsupported_input', 'PNG chunk is truncated')
    }
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    if (!/^[A-Za-z]{4}$/.test(type)) {
      throw spriteDocumentError('unsupported_input', 'PNG chunk type is invalid')
    }
    const dataStart = offset + 8
    const data = buffer.subarray(dataStart, dataStart + length)
    const crc = buffer.readUInt32BE(dataStart + length)
    if (crc32(buffer.subarray(offset + 4, dataStart + length)) !== crc) {
      throw spriteDocumentError('unsupported_input', 'PNG chunk checksum failed')
    }
    chunks.push({ type, data })
    offset += 12 + length
    if (type === 'IEND') break
  }
  if (!chunks.length || chunks[0].type !== 'IHDR' || chunks[chunks.length - 1].type !== 'IEND') {
    throw spriteDocumentError('unsupported_input', 'PNG chunk structure is invalid')
  }
  if (offset !== buffer.length) {
    throw spriteDocumentError('unsupported_input', 'PNG has trailing bytes')
  }
  return chunks
}

export function inspectStaticSrgbPng(buffer, { maxEdge = SPRITE_DOCUMENT_LIMITS.maxBlankCanvasEdge } = {}) {
  const chunks = readPngChunks(buffer)
  const headerData = chunks[0].data
  if (headerData.length !== 13) {
    throw spriteDocumentError('unsupported_input', 'PNG header is unsupported')
  }
  const header = {
    width: headerData.readUInt32BE(0),
    height: headerData.readUInt32BE(4),
    bitDepth: headerData[8],
    colorType: headerData[9],
    compression: headerData[10],
    filter: headerData[11],
    interlace: headerData[12],
  }
  if (header.compression !== 0 || header.filter !== 0 || header.interlace !== 0 || header.bitDepth !== 8
    || !header.width || !header.height) {
    throw spriteDocumentError('unsupported_input', 'PNG header is unsupported')
  }
  const bytesPerPixel = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[header.colorType]
  if (!bytesPerPixel) throw spriteDocumentError('unsupported_input', 'PNG color type is unsupported')
  if (header.width > maxEdge || header.height > maxEdge) {
    throw spriteDocumentError('resource_limit', `canvas edge exceeds ${maxEdge}`, { limit: maxEdge })
  }
  let hasSrgb = false
  let hasNonSrgbColor = false
  for (const chunk of chunks) {
    if (chunk.type === 'acTL' || chunk.type === 'fcTL' || chunk.type === 'fdAT') {
      throw spriteDocumentError('unsupported_input', 'animated PNG is unsupported')
    }
    if (chunk.type === 'iCCP') {
      throw spriteDocumentError('unsupported_input', 'embedded ICC profiles are unsupported')
    }
    if (chunk.type === 'sRGB') {
      if (chunk.data.length !== 1 || chunk.data[0] > 3) {
        throw spriteDocumentError('unsupported_input', 'PNG sRGB declaration is invalid')
      }
      hasSrgb = true
    }
    if (chunk.type === 'cHRM' || chunk.type === 'gAMA') hasNonSrgbColor = true
    if (chunk.type === 'cICP') {
      const srgbCicp = chunk.data.length >= 4
        && chunk.data[0] === 1
        && chunk.data[1] === 13
        && chunk.data[2] === 0
      if (!srgbCicp) {
        throw spriteDocumentError('unsupported_input', 'non-sRGB color declaration is unsupported')
      }
      hasSrgb = true
    }
  }
  if (hasNonSrgbColor && !hasSrgb) {
    throw spriteDocumentError('unsupported_input', 'non-sRGB color declaration is unsupported')
  }
  return {
    width: header.width,
    height: header.height,
    colorType: header.colorType,
    scanlineBytes: (header.width * bytesPerPixel + 1) * header.height,
  }
}

export function decodePngToRgba(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw spriteDocumentError('unsupported_input', 'source is not a PNG')
  }
  if (buffer.length > SPRITE_DOCUMENT_LIMITS.maxManagedPngBytes) {
    throw spriteDocumentError('resource_limit', 'managed PNG exceeds 32MiB', {
      limit: SPRITE_DOCUMENT_LIMITS.maxManagedPngBytes,
    })
  }
  let offset = 8
  let header = null
  let palette = null
  let transparency = null
  const dataParts = []
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    const crc = buffer.readUInt32BE(offset + 8 + length)
    if (crc32(buffer.subarray(offset + 4, offset + 8 + length)) !== crc) {
      throw spriteDocumentError('unsupported_input', 'PNG chunk checksum failed')
    }
    offset += 12 + length
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      }
    } else if (type === 'PLTE') palette = Buffer.from(data)
    else if (type === 'tRNS') transparency = Buffer.from(data)
    else if (type === 'IDAT') dataParts.push(data)
    else if (type === 'IEND') break
  }
  if (!header || header.compression !== 0 || header.filter !== 0 || header.interlace !== 0 || header.bitDepth !== 8
    || !header.width || !header.height) {
    throw spriteDocumentError('unsupported_input', 'PNG header is unsupported')
  }
  if (header.width * header.height > SPRITE_DOCUMENT_LIMITS.maxSheetPixels) {
    throw spriteDocumentError('resource_limit', 'sheet decode exceeds 4096^2 pixels', {
      limit: SPRITE_DOCUMENT_LIMITS.maxSheetPixels,
    })
  }
  const bytesPerPixel = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[header.colorType]
  if (!bytesPerPixel) throw spriteDocumentError('unsupported_input', 'PNG color type is unsupported')
  const expected = (header.width * bytesPerPixel + 1) * header.height
  let inflated
  try {
    inflated = inflateSync(Buffer.concat(dataParts), { maxOutputLength: expected })
  } catch {
    throw spriteDocumentError('unsupported_input', 'PNG pixel data exceeds its scanline budget')
  }
  if (inflated.length !== expected) throw spriteDocumentError('unsupported_input', 'PNG pixel data is truncated')
  const raw = unfilter(inflated, header.width, header.height, bytesPerPixel)
  return {
    width: header.width,
    height: header.height,
    rgba: expandToRgba(raw, header.width, header.height, header.colorType, palette, transparency),
  }
}

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff])
const SHARP_LIMIT_INPUT_PIXELS = 268402689
const IMPORT_RGBA_MAX_BYTES = 4 * 1024 * 1024

function orientedJpegSize(meta) {
  const orientation = Number(meta.orientation) || 1
  if (orientation >= 5 && orientation <= 8) {
    return { width: meta.height, height: meta.width }
  }
  return { width: meta.width, height: meta.height }
}

export async function inspectUploadedJpeg(buffer, { maxEdge = SPRITE_DOCUMENT_LIMITS.maxBlankCanvasEdge } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3 || !buffer.subarray(0, 3).equals(JPEG_SIGNATURE)) {
    throw spriteDocumentError('unsupported_input', 'source is not a JPEG')
  }
  if (buffer.length > SPRITE_DOCUMENT_LIMITS.maxManagedPngBytes) {
    throw spriteDocumentError('resource_limit', 'managed JPEG exceeds 32MiB', {
      limit: SPRITE_DOCUMENT_LIMITS.maxManagedPngBytes,
    })
  }
  let meta
  try {
    meta = await sharp(buffer, {
      failOn: 'error',
      limitInputPixels: SHARP_LIMIT_INPUT_PIXELS,
    }).metadata()
  } catch (error) {
    const message = String(error?.message || '')
    if (/pixel limit|exceeds pixel/i.test(message)) {
      throw spriteDocumentError('resource_limit', 'JPEG decode exceeds the input pixel limit', {
        limit: SHARP_LIMIT_INPUT_PIXELS,
      })
    }
    throw spriteDocumentError('unsupported_input', 'JPEG could not be inspected')
  }
  if (meta.format !== 'jpeg' || !meta.width || !meta.height) {
    throw spriteDocumentError('unsupported_input', 'source is not a JPEG')
  }
  if (meta.width * meta.height > SHARP_LIMIT_INPUT_PIXELS) {
    throw spriteDocumentError('resource_limit', 'JPEG decode exceeds the input pixel limit', {
      limit: SHARP_LIMIT_INPUT_PIXELS,
    })
  }
  const oriented = orientedJpegSize(meta)
  if (!oriented.width || !oriented.height) {
    throw spriteDocumentError('unsupported_input', 'JPEG size is unsupported')
  }
  if (oriented.width > maxEdge || oriented.height > maxEdge) {
    throw spriteDocumentError('resource_limit', `canvas edge exceeds ${maxEdge}`, { limit: maxEdge })
  }
  if (oriented.width * oriented.height * 4 > IMPORT_RGBA_MAX_BYTES) {
    throw spriteDocumentError('resource_limit', 'decoded RGBA exceeds 4MiB', {
      limit: IMPORT_RGBA_MAX_BYTES,
    })
  }
  return {
    width: oriented.width,
    height: oriented.height,
    orientation: Number(meta.orientation) || 1,
  }
}

function jpegProfileWarning(warning) {
  return /invalid embedded profile|invalid profile|corrupt profile/i.test(String(warning || ''))
}

export async function decodeJpegToRgba(buffer) {
  const inspected = await inspectUploadedJpeg(buffer)
  const warnings = []
  const pipeline = sharp(buffer, {
    failOn: 'error',
    limitInputPixels: SHARP_LIMIT_INPUT_PIXELS,
  })
  pipeline.on('warning', (warning) => warnings.push(String(warning)))
  let decoded
  try {
    decoded = await pipeline
      .rotate()
      .toColorspace('srgb')
      .removeAlpha()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
  } catch {
    throw spriteDocumentError('unsupported_input', 'JPEG could not be decoded')
  }
  if (warnings.some(jpegProfileWarning)) {
    throw spriteDocumentError('unsupported_input', 'JPEG color profile could not be converted')
  }
  if (decoded.info.width !== inspected.width
    || decoded.info.height !== inspected.height
    || decoded.info.channels !== 4) {
    throw spriteDocumentError('unsupported_input', 'JPEG decode did not match the inspected size')
  }
  const rgba = Buffer.from(decoded.data)
  if (rgba.length !== inspected.width * inspected.height * 4) {
    throw spriteDocumentError('unsupported_input', 'JPEG decode size is unsupported')
  }
  for (let index = 3; index < rgba.length; index += 4) rgba[index] = 255
  return { width: inspected.width, height: inspected.height, rgba }
}

function timestamp(now = new Date()) {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString()
}

function cacheGet(key) {
  const value = pixelCache.get(key)
  if (!value) return null
  pixelCache.delete(key)
  pixelCache.set(key, value)
  return value
}

function cacheSet(key, buffer) {
  if (buffer.length > SPRITE_DOCUMENT_LIMITS.maxPixelCacheBytes) return
  while (pixelCache.size && pixelCacheBytes + buffer.length > SPRITE_DOCUMENT_LIMITS.maxPixelCacheBytes) {
    const oldest = pixelCache.keys().next().value
    pixelCacheBytes -= pixelCache.get(oldest).length
    pixelCache.delete(oldest)
  }
  pixelCache.set(key, buffer)
  pixelCacheBytes += buffer.length
}

async function readV1Bytes(filePath, kind) {
  try {
    const identity = await lstat(filePath)
    if (identity.isSymbolicLink() || !identity.isFile()) {
      throw spriteDocumentError('artifact_integrity_failed', `${kind} identity is unsafe`)
    }
    return await readFile(filePath)
  } catch (error) {
    if (error instanceof SpriteDocumentError) throw error
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      throw spriteDocumentError('not_found', `${kind} was not found`)
    }
    throw spriteDocumentError('artifact_integrity_failed', `${kind} could not be read`)
  }
}

async function readProjectIfPresent(filePath) {
  try {
    await lstat(filePath)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw spriteDocumentError('storage_commit_failed', 'project index could not be inspected')
  }
  try {
    return parseEditorProjectJson(await readV1Bytes(filePath, 'project index'))
  } catch (error) {
    if (error instanceof SpriteDocumentError) throw error
    throw spriteDocumentError('storage_commit_failed', 'project index could not be read')
  }
}

async function receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot) {
  const receipt = await lookupProjectReceipt(project, operationId, { projectRoot, workspaceRoot })
  if (!receipt) return null
  if (receipt.payload_sha256 !== payloadSha256(payload)) {
    throw spriteDocumentError('operation_conflict', 'operation payload does not match the committed receipt')
  }
  return receipt
}

// A recovered native job is a single imported asset, even when its HTTP receipt
// was lost and a refreshed page has a new operation ID. Called inside the lock.
function generatedImageAlreadyImported(project, generatedSource) {
  return Boolean(generatedSource?.jobId && Object.values(project.assets || {}).some(asset =>
    Object.values(asset.revisions || {}).some(revision => revision.source_job_id === generatedSource.jobId)))
}

function attachDocumentCanvas(next, { documentId, canvasId, manifestSha, createdAt }) {
  next.sprite_documents[documentId] = {
    id: documentId,
    working_revision: 1,
    accepted_revision: null,
    revisions: {
      1: {
        manifest_sha256: manifestSha,
        parent_revision: null,
        created_at: createdAt,
      },
    },
  }
  next.canvases[canvasId] = {
    id: canvasId,
    page_id: next.pages[0].id,
    document_id: documentId,
    x: 0,
    y: 0,
  }
  next.pages[0].canvas_order.push(canvasId)
}

function makeReceipt({
  operationId,
  payload,
  project,
  documentId = null,
  documentRevision = null,
}) {
  return {
    operation_id: operationId,
    payload_sha256: payloadSha256(payload),
    project_id: project.id,
    project_revision: project.revision,
    document_id: documentId,
    document_revision: documentRevision,
  }
}

async function writeTrustedV1File({
  controlledRootPath,
  filePath,
  bytes,
  exclusive = false,
  fault = null,
  faultName = null,
  syncFault = null,
}) {
  if (faultName && fault === faultName) {
    throw spriteDocumentError('storage_commit_failed', `${faultName} commit failed`)
  }
  try {
    return await writeTrustedRegularFile({
      controlledRootPath,
      filePath,
      bytes,
      exclusive,
      errorCode: 'unsafe_artifact_path',
      syncFault,
    })
  } catch (error) {
    if (error instanceof SpriteDocumentError) throw error
    if (error?.published) {
      throw spriteDocumentError(
        'storage_commit_failed',
        exclusive ? 'immutable file durability is unconfirmed' : 'project index durability is unconfirmed',
        { committed: true },
      )
    }
    throw spriteDocumentError('storage_commit_failed', exclusive
      ? 'immutable file could not be committed'
      : 'project index could not be committed')
  }
}

async function confirmPublishedDurability(paths, extraDirectories = []) {
  const directories = [paths.projectDir, paths.projectsDir, ...extraDirectories]
  for (const directoryPath of directories) {
    try {
      await fsyncTrustedDirectory(directoryPath)
    } catch {
      throw spriteDocumentError('storage_commit_failed', 'project directory could not be synchronized', {
        committed: true,
      })
    }
  }
}

async function publishV1ProjectJson(paths, project, { fault = null, create = false } = {}) {
  const head = await prepareHistoryProject(paths, project, {
    fault,
    create,
    verifyLegacyRevision: async (legacy, documentId, revision) => {
      const committed = await loadCommittedManifest(legacy, documentId, revision, undefined, paths.workspaceRoot)
      for (const cel of Object.values(committed.manifest.cels)) {
        if (!cel.block) continue
        const bytes = await readV1Bytes(spriteDocumentBlockPath(committed.paths, cel.block.sha256), 'block')
        if (sha256Bytes(bytes) !== cel.block.sha256 || bytes.length !== cel.block.w * cel.block.h * 4) {
          throw spriteDocumentError('artifact_integrity_failed', 'legacy block does not match its reference')
        }
      }
    },
  })
  if (fault === 'index') throw spriteDocumentError('storage_commit_failed', 'index commit failed')
  const serialized = serializeEditorProject(head)
  assertJsonByteLimit(serialized, SPRITE_DOCUMENT_LIMITS.maxProjectJsonBytes, 'project JSON')
  await writeTrustedV1File({
    controlledRootPath: paths.workspaceRoot,
    filePath: paths.projectJson,
    bytes: Buffer.from(serialized, 'utf8'),
    exclusive: false,
    syncFault: fault === 'index_sync' ? 'publish' : null,
  })
  for (const key of Object.keys(project)) delete project[key]
  Object.assign(project, head)
}

async function persistCommittedReferences({ workspaceRoot, fileWrites, fault = null }) {
  const directories = new Set()
  for (const write of fileWrites) {
    await writeTrustedV1File({
      controlledRootPath: workspaceRoot,
      filePath: write.filePath,
      bytes: write.bytes,
      exclusive: true,
      fault: write.fault,
      faultName: write.faultName,
      syncFault: write.syncFault ?? (fault === 'dirsync' ? 'parent' : null),
    })
    directories.add(path.dirname(write.filePath))
  }
  for (const directoryPath of directories) {
    try {
      await fsyncTrustedDirectory(directoryPath)
    } catch {
      throw spriteDocumentError('storage_commit_failed', 'document directory could not be synchronized')
    }
  }
}

function assertV1Project(project) {
  if (!isPixelEditorProject(project)) {
    throw spriteDocumentError('unsupported_input', 'sprite documents require editor_project_v1 or editor_project_v2')
  }
  return project
}

function sliceRgba(source, sourceWidth, sourceHeight, rect) {
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > sourceWidth || rect.y + rect.h > sourceHeight) {
    throw spriteDocumentError('unsupported_input', 'frame rectangle escapes the source sheet')
  }
  const dest = Buffer.alloc(rect.w * rect.h * 4)
  for (let row = 0; row < rect.h; row += 1) {
    const start = ((rect.y + row) * sourceWidth + rect.x) * 4
    source.copy(dest, row * rect.w * 4, start, start + rect.w * 4)
  }
  return dest
}

function frameRectFromIndex(index, frameSize, sheetWidth) {
  const columns = Math.floor(sheetWidth / frameSize.w)
  if (columns < 1) throw spriteDocumentError('unsupported_input', 'sheet frame size does not fit the source')
  return {
    x: (index % columns) * frameSize.w,
    y: Math.floor(index / columns) * frameSize.h,
    w: frameSize.w,
    h: frameSize.h,
  }
}

async function readOptionalRevisionJson(projectId, asset, revision, artifactKey, projectRoot, workspaceRoot) {
  if (!revision?.artifacts?.[artifactKey]) return null
  try {
    const filePath = await resolveManagedRevisionArtifactFile({
      projectId,
      assetId: asset.id,
      revision,
      artifactKey,
      projectRoot,
      workspaceRoot,
    })
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    return null
  }
}

function buildFramesFromSource({
  decoded,
  asset,
  artifact,
  editorMetadata,
  requireSheetLayout = false,
  strictTiming = false,
}) {
  if (artifact === 'image') {
    return [{
      id: 'frame_1',
      duration_ms: 1000,
      rect: { x: 0, y: 0, w: decoded.width, h: decoded.height },
    }]
  }
  const metadataFrames = editorMetadata?.frames && typeof editorMetadata.frames === 'object'
    ? Object.entries(editorMetadata.frames)
    : []
  if (metadataFrames.length) {
    return metadataFrames.map(([key, frame], index) => {
      const rect = frame?.frame
      if (!isPositiveInteger(rect?.w) || !isPositiveInteger(rect?.h)) {
        throw spriteDocumentError('unsupported_input', 'editor metadata frame rectangle is invalid')
      }
      const fps = editorMetadata.frame_tags?.find((tag) => tag?.name === frame.runtime_action)?.fps
        ?? asset.clips?.[frame.runtime_action]?.fps
        ?? (strictTiming ? null : 8)
      const duration = Number.isInteger(frame.duration) && frame.duration >= 0
        ? frame.duration
        : durationFromFps(fps)
      const id = isValidId(key) ? key : `frame_${index + 1}`
      return { id, duration_ms: duration, rect }
    })
  }
  const clips = Object.values(asset.clips ?? {})
  if (!clips.length) {
    if (requireSheetLayout) {
      throw spriteDocumentError('unsupported_input', 'sheet metadata has no reliable frame layout')
    }
    return [{
      id: 'frame_1',
      duration_ms: 1000,
      rect: { x: 0, y: 0, w: decoded.width, h: decoded.height },
    }]
  }
  const frameSize = clips[0].frame_size
  if (!isPositiveInteger(frameSize?.w) || !isPositiveInteger(frameSize?.h)) {
    throw spriteDocumentError('unsupported_input', 'clip frame size is invalid')
  }
  const seen = new Set()
  const frames = []
  for (const clip of clips) {
    const fps = clip.fps
    for (const index of clip.frames ?? []) {
      if (seen.has(index)) continue
      seen.add(index)
      frames.push({
        id: `frame_${index + 1}`,
        duration_ms: durationFromFps(fps),
        rect: frameRectFromIndex(index, frameSize, decoded.width),
      })
    }
  }
  if (!frames.length) throw spriteDocumentError('unsupported_input', 'sheet metadata has no frames')
  return frames
}

function buildManifestFromFrames({
  projectId,
  documentId,
  name,
  frames,
  decoded,
  source,
}) {
  const canvas = { w: frames[0].rect.w, h: frames[0].rect.h }
  const layer = {
    id: 'layer_1',
    name: 'Layer 1',
    kind: 'raster',
    visible: true,
    locked: false,
  }
  const blocks = new Map()
  const cels = {}
  for (const frame of frames) {
    if (frame.rect.w !== canvas.w || frame.rect.h !== canvas.h) {
      throw spriteDocumentError('unsupported_input', 'source frames do not share one canvas size')
    }
    const pixels = frame.rgba
      ? Buffer.from(frame.rgba)
      : sliceRgba(decoded.rgba, decoded.width, decoded.height, frame.rect)
    const digest = sha256Bytes(pixels)
    if (!blocks.has(digest)) blocks.set(digest, { sha256: digest, w: canvas.w, h: canvas.h, bytes: pixels })
    const celId = `cel_${frame.id}_layer_1`
    cels[celId] = {
      id: celId,
      frame_id: frame.id,
      layer_id: 'layer_1',
      block: { sha256: digest, w: canvas.w, h: canvas.h },
    }
  }
  const manifest = {
    version: SPRITE_DOCUMENT_VERSION,
    document_id: documentId,
    project_id: projectId,
    name,
    revision: 1,
    parent_revision: null,
    canvas,
    color: { format: 'rgba8', alpha: 'straight', space: 'srgb' },
    frame_order: frames.map((frame) => frame.id),
    layer_order: [layer.id],
    frames: Object.fromEntries(frames.map((frame) => [frame.id, { id: frame.id, duration_ms: frame.duration_ms }])),
    layers: { [layer.id]: layer },
    cels,
    tags: [],
    palette: [],
    anchors: [],
    source_ref: clonePlain(source),
  }
  assertDocumentLimits(manifest)
  assertValidSpriteDocument(manifest)
  return { manifest, blocks: [...blocks.values()] }
}

async function loadCommittedManifest(project, documentId, revision, projectRoot, workspaceRoot) {
  const record = project.sprite_documents?.[documentId]
  if (!record) throw spriteDocumentError('not_found', 'sprite document was not found')
  const revisionNumber = revision ?? record.working_revision
  const revisionRecord = await lookupProjectRevision(project, documentId, revisionNumber, { projectRoot, workspaceRoot })
  if (!revisionRecord) throw spriteDocumentError('not_found', 'sprite document revision was not found')
  const paths = resolveSpriteDocumentPaths({
    projectId: project.id,
    documentId,
    projectRoot,
    workspaceRoot,
  })
  const filePath = spriteDocumentRevisionPath(paths, revisionNumber)
  const bytes = await readV1Bytes(filePath, 'manifest')
  if (sha256Bytes(bytes) !== revisionRecord.manifest_sha256) {
    throw spriteDocumentError('artifact_integrity_failed', 'manifest hash does not match the committed index')
  }
  let manifest
  try {
    manifest = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw spriteDocumentError('artifact_integrity_failed', 'manifest could not be parsed')
  }
  assertValidSpriteDocument(manifest)
  if (manifest.document_id !== documentId || manifest.project_id !== project.id || manifest.revision !== revisionNumber) {
    throw spriteDocumentError('not_found', 'sprite document does not belong to this project')
  }
  return { manifest, revision: revisionNumber, manifest_sha256: revisionRecord.manifest_sha256, paths, bytes }
}

function referencedBlockHashes(manifest) {
  return new Set(Object.values(manifest.cels ?? {}).map((cel) => cel?.block?.sha256).filter(Boolean))
}

export async function createEditorProjectV1({
  operationId,
  name = DEFAULT_V1_PROJECT_NAME,
  payload,
  projectRoot = process.cwd(),
  workspaceRoot,
  now = new Date(),
  fault = null,
} = {}) {
  const projectId = deriveStableId('p', `create-v1:${operationId}`)
  const paths = resolveEditorProjectPaths({ projectId, projectRoot, workspaceRoot })
  return withEditorProjectMutationLock({ projectId, workspaceRoot: paths.workspaceRoot }, async () => {
    const existing = await readProjectIfPresent(paths.projectJson)
    if (existing) {
      const receipt = await receiptFromProject(existing, operationId, payload, projectRoot, workspaceRoot)
      if (!receipt) throw spriteDocumentError('operation_conflict', 'target project already exists')
      await confirmPublishedDurability(paths)
      return { project: existing, receipt, replayed: true }
    }
    try {
      await ensureTrustedContainedDirectory({
        controlledRootPath: paths.workspaceRoot,
        directoryPath: paths.projectsDir,
      })
      await ensureTrustedContainedDirectory({
        controlledRootPath: paths.workspaceRoot,
        directoryPath: paths.projectDir,
        syncFault: fault === 'dirsync' ? 'parent' : null,
      })
    } catch (error) {
      if (error instanceof SpriteDocumentError) throw error
      throw spriteDocumentError('storage_commit_failed', 'project directory could not be created safely')
    }
    const createdAt = timestamp(now)
    const project = createDefaultEditorProjectV1({
      id: projectId,
      name,
      createdAt,
      updatedAt: createdAt,
    })
    const receipt = makeReceipt({ operationId, payload, project, documentId: null, documentRevision: null })
    project.operation_receipts[operationId] = receipt
    await publishV1ProjectJson(paths, project, { fault, create: true })
    if (fault === 'ack') {
      throw spriteDocumentError('storage_commit_failed', 'acknowledgement failed after commit', { committed: true })
    }
    return { project, receipt, replayed: false }
  })
}

export async function createBlankSpriteDocument({ projectId, operationId, expectedRevision, width, height, name, payload,
  projectRoot = process.cwd(), workspaceRoot, now = new Date(), fault = null } = {}) {
  const documentId = deriveStableId('d', `blank:${projectId}:${operationId}`)
  const canvasId = deriveStableId('c', `canvas:${projectId}:${documentId}`)
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    const project = assertV1Project(loaded.project)
    const existing = await receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot)
    if (existing) {
      const committed = await loadCommittedManifest(project, existing.document_id, existing.document_revision, projectRoot, workspaceRoot)
      await confirmPublishedDurability(loaded.paths, [committed.paths.documentDir, committed.paths.revisionsDir])
      return { project, document: committed.manifest, canvas: project.canvases[canvasId] ?? null, receipt: existing, replayed: true }
    }
    if (project.revision !== expectedRevision) throw spriteDocumentError('stale_revision', 'project revision does not match expected_revision')
    if (Object.keys(project.sprite_documents).length >= SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments
      || Object.keys(project.canvases).length >= SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments) throw spriteDocumentError('resource_limit', 'project exceeds 64 canvases or documents')
    const manifest = { version: SPRITE_DOCUMENT_VERSION, document_id: documentId, project_id: projectId,
      name: name ?? 'Untitled canvas', revision: 1, parent_revision: null,
      canvas: { w: width, h: height }, color: { format: 'rgba8', alpha: 'straight', space: 'srgb' },
      frame_order: ['frame_1'], layer_order: ['layer_1'], frames: { frame_1: { id: 'frame_1', duration_ms: 125 } },
      layers: { layer_1: { id: 'layer_1', name: 'Layer 1', kind: 'raster', visible: true, locked: false } },
      cels: { cel_frame_1_layer_1: { id: 'cel_frame_1_layer_1', frame_id: 'frame_1', layer_id: 'layer_1', block: null } },
      tags: [], palette: [], anchors: [], source_ref: null, origin: { type: 'blank' } }
    assertValidSpriteDocument(manifest)
    const sizes = new Map()
    for (const canvas of Object.values(project.canvases)) {
      if (sizes.has(canvas.document_id)) continue
      const other = await loadCommittedManifest(project, canvas.document_id, null, projectRoot, workspaceRoot)
      sizes.set(canvas.document_id, other.manifest.canvas)
    }
    const position = placeWorkingCanvas({ id: null, page_id: project.pages[0].id, x: -width, y: 0 }, manifest.canvas, project.canvases, sizes)
    const docPaths = resolveSpriteDocumentPaths({ projectId, documentId, projectRoot, workspaceRoot })
    await ensureTrustedContainedDirectory({ controlledRootPath: loaded.paths.workspaceRoot, directoryPath: docPaths.blocksDir,
      syncFault: fault === 'dirsync' ? 'parent' : null })
    await fsyncTrustedDirectory(docPaths.blocksDir)
    const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await persistCommittedReferences({ workspaceRoot: loaded.paths.workspaceRoot, fault,
      fileWrites: [{ filePath: spriteDocumentRevisionPath(docPaths, 1), bytes, fault, faultName: 'manifest' }] })
    const createdAt = timestamp(now), next = clonePlain(project)
    next.revision += 1
    next.updated_at = createdAt
    attachDocumentCanvas(next, { documentId, canvasId, manifestSha: sha256Bytes(bytes), createdAt })
    Object.assign(next.canvases[canvasId], position)
    const receipt = makeReceipt({ operationId, payload, project: next, documentId, documentRevision: 1 })
    stageProjectReceipt(next, receipt)
    await publishV1ProjectJson(loaded.paths, next, { fault })
    if (fault === 'ack') throw spriteDocumentError('storage_commit_failed', 'acknowledgement failed after commit', { committed: true })
    return { project: next, document: manifest, canvas: next.canvases[canvasId], receipt, replayed: false }
  })
}

export async function createSpriteDocumentFromManagedSource({
  projectId,
  operationId,
  expectedRevision,
  source,
  name,
  payload,
  projectRoot = process.cwd(),
  workspaceRoot,
  now = new Date(),
  fault = null,
} = {}) {
  const documentId = deriveStableId('d', `sprite-doc:${projectId}:${operationId}`)
  const canvasId = deriveStableId('c', `canvas:${projectId}:${documentId}`)
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    const project = assertV1Project(loaded.project)
    const existingReceipt = await receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot)
    if (existingReceipt) {
      const committed = await loadCommittedManifest(
        project,
        existingReceipt.document_id,
        existingReceipt.document_revision,
        projectRoot,
        workspaceRoot,
      )
      await confirmPublishedDurability(loaded.paths, [
        committed.paths.documentDir,
        committed.paths.revisionsDir,
        committed.paths.blocksDir,
      ])
      return {
        project,
        receipt: existingReceipt,
        document: committed.manifest,
        replayed: true,
      }
    }
    if (project.revision !== expectedRevision) {
      throw spriteDocumentError('stale_revision', 'project revision does not match expected_revision', {
        expected_revision: expectedRevision,
        current_revision: project.revision,
      })
    }
    if (Object.keys(project.sprite_documents).length >= SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments
      || Object.keys(project.canvases).length >= SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments) {
      throw spriteDocumentError('resource_limit', 'project exceeds 64 canvases or documents')
    }
    const asset = project.assets?.[source.asset_id]
    const revision = asset?.revisions?.[source.revision_id]
    if (!asset || !revision || !revision.artifacts?.[source.artifact]) {
      throw spriteDocumentError('not_found', 'managed source artifact was not found')
    }
    if (!['image', 'sheet'].includes(source.artifact)) {
      throw spriteDocumentError('unsupported_input', 'source artifact must be a managed PNG or sheet')
    }
    let filePath
    try {
      filePath = await resolveManagedRevisionArtifactFile({
        projectId,
        assetId: asset.id,
        revision,
        artifactKey: source.artifact,
        projectRoot,
        workspaceRoot,
      })
    } catch (error) {
      if (error?.code === 'unsafe_artifact_path') {
        throw spriteDocumentError('invalid_request', 'source path is unsafe')
      }
      if (error?.code === 'artifact_not_found') throw spriteDocumentError('not_found', 'managed source artifact was not found')
      throw spriteDocumentError('artifact_integrity_failed', 'managed source could not be resolved')
    }
    const fileStat = await lstat(filePath)
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      throw spriteDocumentError('invalid_request', 'source path is unsafe')
    }
    if (fileStat.size > SPRITE_DOCUMENT_LIMITS.maxManagedPngBytes) {
      throw spriteDocumentError('resource_limit', 'managed PNG exceeds 32MiB', {
        limit: SPRITE_DOCUMENT_LIMITS.maxManagedPngBytes,
      })
    }
    const pngBytes = await readFile(filePath)
    const digest = sha256Bytes(pngBytes)
    if (digest !== source.expected_sha256) {
      throw spriteDocumentError('artifact_integrity_failed', 'source hash does not match expected_sha256')
    }
    const decoded = decodePngToRgba(pngBytes)
    if (source.artifact === 'image' && (decoded.width > SPRITE_DOCUMENT_LIMITS.maxCanvasEdge
      || decoded.height > SPRITE_DOCUMENT_LIMITS.maxCanvasEdge)) {
      throw spriteDocumentError('resource_limit', 'canvas edge exceeds 4096', {
        limit: SPRITE_DOCUMENT_LIMITS.maxCanvasEdge,
      })
    }
    const editorMetadata = await readOptionalRevisionJson(
      projectId,
      asset,
      revision,
      'editor_metadata',
      projectRoot,
      workspaceRoot,
    )
    const frames = buildFramesFromSource({
      decoded,
      asset,
      artifact: source.artifact,
      editorMetadata,
    })
    const documentName = name ?? asset.name ?? DEFAULT_V1_DOCUMENT_NAME
    const { manifest, blocks } = buildManifestFromFrames({
      projectId,
      documentId,
      name: documentName,
      frames,
      decoded,
      source,
    })
    const docPaths = resolveSpriteDocumentPaths({
      projectId,
      documentId,
      projectRoot,
      workspaceRoot,
    })
    const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`
    const manifestBytes = Buffer.from(manifestJson, 'utf8')
    const manifestSha = sha256Bytes(manifestBytes)
    await persistCommittedReferences({
      workspaceRoot: loaded.paths.workspaceRoot,
      fault,
      fileWrites: [
        ...blocks.map((block) => ({
          filePath: spriteDocumentBlockPath(docPaths, block.sha256),
          bytes: block.bytes,
          fault,
          faultName: 'block',
        })),
        {
          filePath: spriteDocumentRevisionPath(docPaths, 1),
          bytes: manifestBytes,
          fault,
          faultName: 'manifest',
        },
      ],
    })
    const createdAt = timestamp(now)
    const next = clonePlain(project)
    next.revision += 1
    next.updated_at = createdAt
    attachDocumentCanvas(next, { documentId, canvasId, manifestSha, createdAt })
    const receipt = makeReceipt({
      operationId,
      payload,
      project: next,
      documentId,
      documentRevision: 1,
    })
    stageProjectReceipt(next, receipt)
    await publishV1ProjectJson(loaded.paths, next, { fault })
    if (fault === 'ack') {
      throw spriteDocumentError('storage_commit_failed', 'acknowledgement failed after commit', { committed: true })
    }
    return { project: next, receipt, document: manifest, replayed: false }
  })
}

export async function createSpriteDocumentFromUploadedPng({
  projectId,
  operationId,
  expectedRevision,
  expectedSha256,
  pngBytes,
  generatedSource = null,
  generatedOriginal = null,
  generatedTransformation = null,
  name,
  payload,
  projectRoot = process.cwd(),
  workspaceRoot,
  now = new Date(),
  fault = null,
} = {}) {
  if (!Buffer.isBuffer(pngBytes)) {
    throw spriteDocumentError('unsupported_input', 'source is not a PNG')
  }
  if (pngBytes.length > SPRITE_DOCUMENT_LIMITS.maxManagedPngBytes) {
    throw spriteDocumentError('resource_limit', 'managed PNG exceeds 32MiB', {
      limit: SPRITE_DOCUMENT_LIMITS.maxManagedPngBytes,
    })
  }
  const digest = sha256Bytes(pngBytes)
  if (digest !== expectedSha256) {
    throw spriteDocumentError('artifact_integrity_failed', 'source hash does not match expected_sha256')
  }
  inspectStaticSrgbPng(pngBytes)
  const documentId = deriveStableId('d', `sprite-doc-upload:${projectId}:${operationId}`)
  const canvasId = deriveStableId('c', `canvas:${projectId}:${documentId}`)
  const assetId = deriveStableId('a', `upload-png:${projectId}:${operationId}`)
  const revisionId = deriveStableId('r', `upload-png-rev:${projectId}:${operationId}`)
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    const project = assertV1Project(loaded.project)
    const existingReceipt = await receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot)
    if (!existingReceipt && generatedImageAlreadyImported(project, generatedSource)) {
      return { project, alreadyImported: true, replayed: true }
    }
    if (existingReceipt) {
      const committed = await loadCommittedManifest(
        project,
        existingReceipt.document_id,
        existingReceipt.document_revision,
        projectRoot,
        workspaceRoot,
      )
      const asset = project.assets?.[committed.manifest.source_ref?.asset_id]
      const revision = asset?.revisions?.[committed.manifest.source_ref?.revision_id]
      const extra = [committed.paths.documentDir, committed.paths.revisionsDir, committed.paths.blocksDir]
      if (asset && revision && committed.manifest.source_ref?.artifact === 'image') {
        try {
          const replayImage = await resolveManagedRevisionArtifactFile({
            projectId,
            assetId: asset.id,
            revision,
            artifactKey: 'image',
            projectRoot,
            workspaceRoot,
          })
          extra.push(path.dirname(replayImage))
        } catch (error) {
          if (error instanceof SpriteDocumentError) throw error
          if (error?.code === 'unsafe_artifact_path') {
            throw spriteDocumentError('invalid_request', 'source path is unsafe')
          }
          throw spriteDocumentError('artifact_integrity_failed', 'managed source could not be resolved')
        }
      }
      await confirmPublishedDurability(loaded.paths, extra)
      return {
        project,
        receipt: existingReceipt,
        document: committed.manifest,
        replayed: true,
      }
    }
    if (project.revision !== expectedRevision) {
      throw spriteDocumentError('stale_revision', 'project revision does not match expected_revision', {
        expected_revision: expectedRevision,
        current_revision: project.revision,
      })
    }
    if (Object.keys(project.sprite_documents).length >= SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments
      || Object.keys(project.canvases).length >= SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments) {
      throw spriteDocumentError('resource_limit', 'project exceeds 64 canvases or documents')
    }
    const decoded = decodePngToRgba(pngBytes)
    if (decoded.width > SPRITE_DOCUMENT_LIMITS.maxBlankCanvasEdge
      || decoded.height > SPRITE_DOCUMENT_LIMITS.maxBlankCanvasEdge) {
      throw spriteDocumentError('resource_limit', 'canvas edge exceeds 1024', {
        limit: SPRITE_DOCUMENT_LIMITS.maxBlankCanvasEdge,
      })
    }
    const documentName = name ?? DEFAULT_V1_DOCUMENT_NAME
    const source = {
      asset_id: assetId,
      revision_id: revisionId,
      artifact: 'image',
      expected_sha256: digest,
    }
    const { manifest, blocks } = buildManifestFromFrames({
      projectId,
      documentId,
      name: documentName,
      frames: [{
        id: 'frame_1',
        duration_ms: 1000,
        rect: { x: 0, y: 0, w: decoded.width, h: decoded.height },
      }],
      decoded,
      source,
    })
    let assetPaths
    try {
      assetPaths = resolveManagedAssetRevisionPaths({
        projectId,
        assetId,
        revisionId,
        projectRoot,
        workspaceRoot: loaded.paths.workspaceRoot,
      })
    } catch {
      throw spriteDocumentError('invalid_request', 'source path is unsafe')
    }
    const imagePath = path.join(assetPaths.revisionDir, 'image.png')
    const relativeImage = projectRelativePath(imagePath, { projectRoot: loaded.paths.projectRoot })
    const retainedWrites = []
    const artifacts = { image: relativeImage }
    if (generatedOriginal) {
      // Server-owned native result only; the ordinary upload route supplies none of these fields.
      if (!generatedSource?.jobId || !Buffer.isBuffer(generatedOriginal.bytes)
        || generatedOriginal.bytes.length > 8 * 1024 * 1024
        || !['image/png', 'image/jpeg'].includes(generatedOriginal.mimeType)
        || sha256Bytes(generatedOriginal.bytes) !== generatedOriginal.sha256
        || generatedTransformation?.type !== 'fit') {
        throw spriteDocumentError('artifact_integrity_failed', 'generated original is invalid')
      }
      const originalPath = path.join(assetPaths.revisionDir, generatedOriginal.mimeType === 'image/jpeg' ? 'native-original.jpg' : 'native-original.png')
      const metadataPath = path.join(assetPaths.revisionDir, 'generation-metadata.json')
      artifacts.native_original = projectRelativePath(originalPath, { projectRoot: loaded.paths.projectRoot })
      artifacts.generation_metadata = projectRelativePath(metadataPath, { projectRoot: loaded.paths.projectRoot })
      const metadata = { source_job_id: generatedSource.jobId,
        original: { artifact: 'native_original', sha256: generatedOriginal.sha256, mime_type: generatedOriginal.mimeType,
          width: generatedOriginal.width, height: generatedOriginal.height },
        image: { artifact: 'image', sha256: digest, mime_type: 'image/png', width: manifest.canvas.w, height: manifest.canvas.h },
        transformation: generatedTransformation }
      retainedWrites.push({ filePath: originalPath, bytes: generatedOriginal.bytes, fault, faultName: 'asset' },
        { filePath: metadataPath, bytes: Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`), fault, faultName: 'asset' })
    }
    const asset = createAssetRef({
      id: assetId,
      kind: 'static_image',
      name: documentName,
      revision: createAssetRevision({
        id: revisionId,
        sourceJobId: generatedSource?.jobId ?? null,
        createdAt: timestamp(now),
        qualityStatus: 'pass',
        productionStatus: 'ready',
        artifacts,
      }),
      provenance: generatedSource ? { source_type: 'provider', provider: generatedSource.provider, model: generatedSource.model }
        : { source_type: 'upload', provider: null, model: null },
    })
    const docPaths = resolveSpriteDocumentPaths({
      projectId,
      documentId,
      projectRoot,
      workspaceRoot,
    })
    const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`
    const manifestBytes = Buffer.from(manifestJson, 'utf8')
    const manifestSha = sha256Bytes(manifestBytes)
    await persistCommittedReferences({
      workspaceRoot: loaded.paths.workspaceRoot,
      fault,
      fileWrites: [
        ...retainedWrites,
        {
          filePath: imagePath,
          bytes: pngBytes,
          fault,
          faultName: 'asset',
        },
        ...blocks.map((block) => ({
          filePath: spriteDocumentBlockPath(docPaths, block.sha256),
          bytes: block.bytes,
          fault,
          faultName: 'block',
        })),
        {
          filePath: spriteDocumentRevisionPath(docPaths, 1),
          bytes: manifestBytes,
          fault,
          faultName: 'manifest',
        },
      ],
    })
    const createdAt = timestamp(now)
    const next = clonePlain(project)
    next.revision += 1
    next.updated_at = createdAt
    next.assets[assetId] = asset
    attachDocumentCanvas(next, { documentId, canvasId, manifestSha, createdAt })
    const receipt = makeReceipt({
      operationId,
      payload,
      project: next,
      documentId,
      documentRevision: 1,
    })
    stageProjectReceipt(next, receipt)
    await publishV1ProjectJson(loaded.paths, next, { fault })
    if (fault === 'ack') {
      throw spriteDocumentError('storage_commit_failed', 'acknowledgement failed after commit', { committed: true })
    }
    return { project: next, receipt, document: manifest, replayed: false }
  })
}

function padCanvasRgba(rgba, srcWidth, srcHeight, destWidth, destHeight) {
  if (srcWidth === destWidth && srcHeight === destHeight) return Buffer.from(rgba)
  const dest = Buffer.alloc(destWidth * destHeight * 4)
  for (let y = 0; y < srcHeight; y += 1) {
    rgba.copy(dest, y * destWidth * 4, y * srcWidth * 4, (y + 1) * srcWidth * 4)
  }
  return dest
}

export async function createSpriteDocumentFromGeneralSequence({
  projectId,
  operationId,
  expectedRevision,
  expectedSha256,
  frames,
  background = 'auto',
  name,
  payload,
  preview = false,
  appendDocumentId = null,
  generatedSource = null,
  generatedOriginal = null,
  generatedTransformation = null,
  signal = null,
  projectRoot = process.cwd(),
  workspaceRoot,
  now = new Date(),
  fault = null,
} = {}) {
  if (!Array.isArray(frames) || frames.length < 1 || frames.length > GENERAL_SEQUENCE_MAX_FRAMES) {
    throw spriteDocumentError('invalid_request', `A general sequence needs 1 to ${GENERAL_SEQUENCE_MAX_FRAMES} images.`)
  }
  const documentId = appendDocumentId || deriveStableId('d', `sprite-doc-general-sequence:${projectId}:${operationId}`)
  const canvasId = deriveStableId('c', `canvas:${projectId}:${documentId}`)
  const assetId = deriveStableId('a', `general-sequence:${projectId}:${operationId}`)
  const revisionId = deriveStableId('r', `general-sequence-rev:${projectId}:${operationId}`)
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    const project = assertV1Project(loaded.project)
    if (!preview) {
      const existingReceipt = await receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot)
      if (!existingReceipt && generatedImageAlreadyImported(project, generatedSource)) {
        return { project, alreadyImported: true, replayed: true }
      }
      if (existingReceipt) {
        const committed = await loadCommittedManifest(project, existingReceipt.document_id, existingReceipt.document_revision, projectRoot, workspaceRoot)
        await confirmPublishedDurability(loaded.paths, [committed.paths.documentDir, committed.paths.revisionsDir, committed.paths.blocksDir])
        return { project, receipt: existingReceipt, document: committed.manifest, replayed: true }
      }
    }
    if (project.revision !== expectedRevision) {
      throw spriteDocumentError('stale_revision', 'project revision does not match expected_revision', {
        expected_revision: expectedRevision,
        current_revision: project.revision,
      })
    }
    let existingCommitted = null
    let existingAssetPaths = null
    let priorSequence = null
    if (appendDocumentId) {
      if (preview) {
        throw spriteDocumentError('invalid_request', 'preview cannot append to an existing document')
      }
      existingCommitted = await loadCommittedManifest(project, appendDocumentId, null, projectRoot, workspaceRoot)
      const existingManifest = existingCommitted.manifest
      if (existingManifest.derived_from != null
        || existingManifest.origin?.type === 'blank'
        || existingManifest.layer_order.length !== 1
        || existingManifest.layer_order[0] !== 'layer_1') {
        throw spriteDocumentError('unsupported_input', 'sequence append requires a single-layer general sequence document')
      }
      const sourceRef = existingManifest.source_ref
      const existingAsset = sourceRef?.asset_id ? project.assets?.[sourceRef.asset_id] : null
      const existingRevision = (existingAsset && sourceRef?.revision_id) ? existingAsset.revisions?.[sourceRef.revision_id] : null
      if (!sourceRef?.asset_id || !sourceRef?.revision_id || !existingAsset || !existingRevision || !existingRevision.artifacts?.sequence) {
        throw spriteDocumentError('unsupported_input', 'sequence append requires an existing general sequence document with a sequence source record')
      }
      if (existingManifest.frame_order.length + frames.length > GENERAL_SEQUENCE_MAX_FRAMES) {
        throw spriteDocumentError('resource_limit', `frame count exceeds ${GENERAL_SEQUENCE_MAX_FRAMES}`, {
          limit: GENERAL_SEQUENCE_MAX_FRAMES,
        })
      }
      try {
        existingAssetPaths = resolveManagedAssetRevisionPaths({
          projectId,
          assetId: sourceRef.asset_id,
          revisionId: sourceRef.revision_id,
          projectRoot,
          workspaceRoot: loaded.paths.workspaceRoot,
        })
      } catch {
        throw spriteDocumentError('invalid_request', 'source path is unsafe')
      }
      let existingSequencePath
      try {
        existingSequencePath = await resolveManagedRevisionArtifactFile({
          projectId,
          assetId: sourceRef.asset_id,
          revision: existingRevision,
          artifactKey: 'sequence',
          projectRoot,
          workspaceRoot: loaded.paths.workspaceRoot,
        })
      } catch {
        throw spriteDocumentError('artifact_integrity_failed', 'existing sequence source record path is invalid')
      }
      try {
        priorSequence = JSON.parse((await readV1Bytes(existingSequencePath, 'sequence')).toString('utf8'))
      } catch (error) {
        if (error instanceof SpriteDocumentError) throw error
        throw spriteDocumentError('artifact_integrity_failed', 'existing sequence source record could not be parsed')
      }
      if (!priorSequence || !Array.isArray(priorSequence.frames) || priorSequence.frames.length !== existingManifest.frame_order.length) {
        throw spriteDocumentError('artifact_integrity_failed', 'existing sequence source record does not match committed frames')
      }
    }
    let sequence
    try {
      sequence = await prepareGeneralSequence(frames, {
        background,
        includePlaced: !preview,
        minWidth: existingCommitted ? existingCommitted.manifest.canvas.w : 0,
        minHeight: existingCommitted ? existingCommitted.manifest.canvas.h : 0,
        existingFrameCount: existingCommitted ? existingCommitted.manifest.frame_order.length : 0,
        signal,
      })
    } catch (error) {
      if (error?.name === 'AbortError' || error?.code === 'aborted') throw error
      throw spriteDocumentError(error.code || 'unsupported_input', error.message || 'General sequence could not be prepared.')
    }
    if (preview) {
      return { preview: true, sequence, project }
    }
    if (existingCommitted) {
      const existingManifest = existingCommitted.manifest
      const existingCount = existingManifest.frame_order.length
      const totalFrames = existingCount + sequence.frames.length
      if (totalFrames * sequence.width * sequence.height * 4 > SPRITE_DOCUMENT_LIMITS.maxExpandedRgbaBytes) {
        throw spriteDocumentError('resource_limit', 'expanded RGBA exceeds 128MiB', {
          limit: SPRITE_DOCUMENT_LIMITS.maxExpandedRgbaBytes,
        })
      }
      const paddedBlocks = new Map()
      const paddedPriorWorkingDigests = new Map()
      const updatedCels = clonePlain(existingManifest.cels)
      if (sequence.width > existingManifest.canvas.w || sequence.height > existingManifest.canvas.h) {
        for (let frameIdx = 0; frameIdx < existingManifest.frame_order.length; frameIdx += 1) {
          const frameId = existingManifest.frame_order[frameIdx]
          const celId = `cel_${frameId}_layer_1`
          const celBytes = await readCelBytes(existingManifest, existingCommitted.paths, {
            frame_id: frameId,
            layer_id: 'layer_1',
            cel_id: celId,
          })
          const padded = padCanvasRgba(celBytes, existingManifest.canvas.w, existingManifest.canvas.h, sequence.width, sequence.height)
          const digest = sha256Bytes(padded)
          paddedBlocks.set(digest, { sha256: digest, bytes: padded })
          paddedPriorWorkingDigests.set(frameIdx, digest)
          updatedCels[celId] = {
            id: celId,
            frame_id: frameId,
            layer_id: 'layer_1',
            block: { sha256: digest, w: sequence.width, h: sequence.height },
          }
        }
      }
      const nextFrameOrder = [...existingManifest.frame_order]
      const nextFrames = clonePlain(existingManifest.frames)
      sequence.frames.forEach((frame, index) => {
        const frameId = `frame_${existingCount + index + 1}`
        const celId = `cel_${frameId}_layer_1`
        const digest = sha256Bytes(frame.placed)
        paddedBlocks.set(digest, { sha256: digest, bytes: frame.placed })
        nextFrameOrder.push(frameId)
        nextFrames[frameId] = { id: frameId, duration_ms: 125 }
        updatedCels[celId] = {
          id: celId,
          frame_id: frameId,
          layer_id: 'layer_1',
          block: { sha256: digest, w: sequence.width, h: sequence.height },
        }
      })
      const record = project.sprite_documents[appendDocumentId]
      const slot = await resolveRevisionSlot(record, existingCommitted.paths, (revision) => {
        const manifest = {
          ...clonePlain(existingManifest),
          revision,
          parent_revision: record.working_revision,
          canvas: { w: sequence.width, h: sequence.height },
          frame_order: nextFrameOrder,
          frames: nextFrames,
          cels: updatedCels,
        }
        assertDocumentLimits(manifest)
        assertValidSpriteDocument(manifest)
        return manifest
      })
      for (const block of paddedBlocks.values()) {
        await writeBlockIfAbsent({
          workspaceRoot: loaded.paths.workspaceRoot,
          paths: existingCommitted.paths,
          sha256: block.sha256,
          bytes: block.bytes,
          fault,
        })
      }
      const sourceRef = existingManifest.source_ref
      const opTag = sha256Bytes(Buffer.from(String(operationId), 'utf8')).slice(0, 12)
      const appendedArtifactEntries = {}
      const appendedWrites = []
      const appendedFrames = sequence.frames.map((frame, index) => {
        const frameIndex = existingCount + index
        const originalBytes = Buffer.from(frames[index].bytes)
        const originalKind = classifySequenceImage(originalBytes)
        if (!originalKind) throw spriteDocumentError('unsupported_input', 'Sequence images must be PNG or JPEG.')
        const originalExt = originalKind === 'jpeg' ? 'jpg' : 'png'
        const originalPath = path.join(existingAssetPaths.revisionDir, `frame-${frameIndex}-r${slot.revision}-${opTag}-original.${originalExt}`)
        const recoveredPath = path.join(existingAssetPaths.revisionDir, `frame-${frameIndex}-r${slot.revision}-${opTag}-recovered.png`)
        const recoveredBytes = encodeRgbaPng(frame.width, frame.height, frame.cRgba)
        appendedArtifactEntries[`frame_${frameIndex}_original`] = projectRelativePath(originalPath, { projectRoot: loaded.paths.projectRoot })
        appendedArtifactEntries[`frame_${frameIndex}_recovered`] = projectRelativePath(recoveredPath, { projectRoot: loaded.paths.projectRoot })
        appendedWrites.push(
          { filePath: originalPath, bytes: originalBytes, fault, faultName: 'asset' },
          { filePath: recoveredPath, bytes: recoveredBytes, fault, faultName: 'asset' },
        )
        return {
          index: frameIndex,
          duration_ms: 125,
          anchor: frame.anchor,
          source_size: { w: frame.width, h: frame.height },
          placed_width: frame.placedWidth,
          placed_height: frame.placedHeight,
          padded: Boolean(frame.padded),
          original_sha256: sha256Bytes(originalBytes),
          recovered_sha256: sha256Bytes(recoveredBytes),
          working_sha256: sha256Bytes(frame.placed),
          recovery_status: frame.recovery.status,
          recovery_reason: frame.recovery.reason,
          exact_recovery: frame.recovery.exact_recovery,
          transparent_source: frame.transparentSource,
          background_status: frame.backgroundStatus,
          background_reason: frame.backgroundReason,
          background_color: frame.backgroundColor,
          omitted_count: frame.omittedCount ?? frame.omitted.length,
        }
      })
      const updatedPriorFrames = priorSequence.frames.map((item, idx) => (
        paddedPriorWorkingDigests.has(idx)
          ? {
            ...item,
            padded: true,
            placed_width: sequence.width,
            placed_height: sequence.height,
            working_sha256: paddedPriorWorkingDigests.get(idx),
          }
          : item
      ))
      const allFrames = [...updatedPriorFrames, ...appendedFrames]
      const updatedSequenceRecord = {
        ...priorSequence,
        canvas: { w: sequence.width, h: sequence.height },
        grid_consistent: Boolean(priorSequence.grid_consistent && sequence.gridConsistent
          && allFrames.every((item) => item.source_size?.w === allFrames[0]?.source_size?.w && item.source_size?.h === allFrames[0]?.source_size?.h)),
        request_sha256: expectedSha256,
        frames: allFrames,
      }
      const nextSequencePath = path.join(existingAssetPaths.revisionDir, `sequence-r${slot.revision}-${opTag}.json`)
      appendedArtifactEntries.sequence = projectRelativePath(nextSequencePath, { projectRoot: loaded.paths.projectRoot })
      appendedWrites.push({
        filePath: nextSequencePath,
        bytes: Buffer.from(`${JSON.stringify(updatedSequenceRecord, null, 2)}\n`),
        fault,
        faultName: 'asset',
      })
      await persistCommittedReferences({
        workspaceRoot: loaded.paths.workspaceRoot,
        fault: slot.reuse ? null : fault,
        fileWrites: [
          ...appendedWrites,
          {
            filePath: spriteDocumentRevisionPath(existingCommitted.paths, slot.revision),
            bytes: slot.bytes,
            fault: slot.reuse ? null : fault,
            faultName: slot.reuse ? null : 'manifest',
            syncFault: !slot.reuse && fault === 'manifest_sync' ? 'publish' : null,
          },
        ],
      })
      const createdAt = timestamp(now)
      const next = clonePlain(project)
      next.revision += 1
      next.updated_at = createdAt
      Object.assign(next.assets[sourceRef.asset_id].revisions[sourceRef.revision_id].artifacts, appendedArtifactEntries)
      appendWorkingRevision(next, appendDocumentId, {
        manifestSha: sha256Bytes(slot.bytes),
        createdAt,
        parentRevision: record.working_revision,
        revision: slot.revision,
      })
      const receipt = makeReceipt({
        operationId,
        payload,
        project: next,
        documentId: appendDocumentId,
        documentRevision: slot.revision,
      })
      stageProjectReceipt(next, receipt)
      await publishV1ProjectJson(loaded.paths, next, { fault })
      if (fault === 'ack') throw spriteDocumentError('storage_commit_failed', 'acknowledgement failed after commit', { committed: true })
      return { project: next, receipt, document: slot.manifest, sequence: updatedSequenceRecord, replayed: false }
    }
    if (Object.keys(project.sprite_documents).length >= SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments
      || Object.keys(project.canvases).length >= SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments) {
      throw spriteDocumentError('resource_limit', 'project exceeds 64 canvases or documents')
    }
    const documentName = name ?? DEFAULT_V1_DOCUMENT_NAME
    const imagePng = encodeRgbaPng(sequence.width, sequence.height, sequence.frames[0].placed)
    const imageDigest = sha256Bytes(imagePng)
    const source = {
      asset_id: assetId,
      revision_id: revisionId,
      artifact: 'image',
      expected_sha256: imageDigest,
    }
    const { manifest, blocks } = buildManifestFromFrames({
      projectId,
      documentId,
      name: documentName,
      frames: sequence.frames.map((frame, index) => ({
        id: `frame_${index + 1}`,
        duration_ms: 125,
        rect: { x: 0, y: 0, w: sequence.width, h: sequence.height },
        rgba: frame.placed,
      })),
      decoded: null,
      source,
    })
    let assetPaths
    try {
      assetPaths = resolveManagedAssetRevisionPaths({
        projectId,
        assetId,
        revisionId,
        projectRoot,
        workspaceRoot: loaded.paths.workspaceRoot,
      })
    } catch {
      throw spriteDocumentError('invalid_request', 'source path is unsafe')
    }
    const imagePath = path.join(assetPaths.revisionDir, 'image.png')
    const sequencePath = path.join(assetPaths.revisionDir, 'sequence.json')
    const artifacts = {
      image: projectRelativePath(imagePath, { projectRoot: loaded.paths.projectRoot }),
      sequence: projectRelativePath(sequencePath, { projectRoot: loaded.paths.projectRoot }),
    }
    const retainedWrites = [{ filePath: imagePath, bytes: imagePng, fault, faultName: 'asset' }]
    if (generatedOriginal) {
      if (!generatedSource?.jobId || !Buffer.isBuffer(generatedOriginal.bytes)
        || generatedOriginal.bytes.length > 8 * 1024 * 1024
        || !['image/png', 'image/jpeg'].includes(generatedOriginal.mimeType)
        || sha256Bytes(generatedOriginal.bytes) !== generatedOriginal.sha256
        || generatedTransformation?.type !== 'fit') {
        throw spriteDocumentError('artifact_integrity_failed', 'generated original is invalid')
      }
      const fittedInputBytes = Buffer.from(frames[0].bytes)
      const fittedInputKind = classifySequenceImage(fittedInputBytes)
      if (!fittedInputKind) throw spriteDocumentError('unsupported_input', 'Sequence images must be PNG or JPEG.')
      const fittedInputWidth = sequence.frames[0]?.inputWidth ?? sequence.frames[0]?.width ?? manifest.canvas.w
      const fittedInputHeight = sequence.frames[0]?.inputHeight ?? sequence.frames[0]?.height ?? manifest.canvas.h
      const originalPath = path.join(assetPaths.revisionDir, generatedOriginal.mimeType === 'image/jpeg' ? 'native-original.jpg' : 'native-original.png')
      const metadataPath = path.join(assetPaths.revisionDir, 'generation-metadata.json')
      artifacts.native_original = projectRelativePath(originalPath, { projectRoot: loaded.paths.projectRoot })
      artifacts.generation_metadata = projectRelativePath(metadataPath, { projectRoot: loaded.paths.projectRoot })
      const metadata = {
        source_job_id: generatedSource.jobId,
        original: {
          artifact: 'native_original',
          sha256: generatedOriginal.sha256,
          mime_type: generatedOriginal.mimeType,
          width: generatedOriginal.width,
          height: generatedOriginal.height,
        },
        image: {
          artifact: 'frame_0_original',
          sha256: sha256Bytes(fittedInputBytes),
          mime_type: fittedInputKind === 'jpeg' ? 'image/jpeg' : 'image/png',
          width: fittedInputWidth,
          height: fittedInputHeight,
        },
        transformation: generatedTransformation,
      }
      retainedWrites.push(
        { filePath: originalPath, bytes: generatedOriginal.bytes, fault, faultName: 'asset' },
        { filePath: metadataPath, bytes: Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`), fault, faultName: 'asset' },
      )
    }
    const recordFrames = sequence.frames.map((frame, index) => {
      const originalBytes = Buffer.from(frames[index].bytes)
      const originalKind = classifySequenceImage(originalBytes)
      if (!originalKind) throw spriteDocumentError('unsupported_input', 'Sequence images must be PNG or JPEG.')
      const originalExt = originalKind === 'jpeg' ? 'jpg' : 'png'
      const originalPath = path.join(assetPaths.revisionDir, `frame-${index}-original.${originalExt}`)
      const recoveredPath = path.join(assetPaths.revisionDir, `frame-${index}-recovered.png`)
      const recoveredBytes = encodeRgbaPng(frame.width, frame.height, frame.cRgba)
      artifacts[`frame_${index}_original`] = projectRelativePath(originalPath, { projectRoot: loaded.paths.projectRoot })
      artifacts[`frame_${index}_recovered`] = projectRelativePath(recoveredPath, { projectRoot: loaded.paths.projectRoot })
      retainedWrites.push(
        { filePath: originalPath, bytes: originalBytes, fault, faultName: 'asset' },
        { filePath: recoveredPath, bytes: recoveredBytes, fault, faultName: 'asset' },
      )
      return {
        index,
        duration_ms: 125,
        anchor: frame.anchor,
        source_size: { w: frame.width, h: frame.height },
        original_sha256: sha256Bytes(originalBytes),
        recovered_sha256: sha256Bytes(recoveredBytes),
        working_sha256: sha256Bytes(frame.placed),
        recovery_status: frame.recovery.status,
        recovery_reason: frame.recovery.reason,
        exact_recovery: frame.recovery.exact_recovery,
        transparent_source: frame.transparentSource,
        background_status: frame.backgroundStatus,
        background_reason: frame.backgroundReason,
        background_color: frame.backgroundColor,
        omitted_count: frame.omittedCount ?? frame.omitted.length,
      }
    })
    const sequenceRecord = {
      version: 1,
      method: 'global_median_v1',
      pixel_finishing: false,
      background: sequence.background,
      anchor: sequence.anchor,
      placement: 'top_left_transparent_pad',
      scaled: false,
      canvas: { w: sequence.width, h: sequence.height },
      grid_consistent: sequence.gridConsistent,
      request_sha256: expectedSha256,
      quality: 'unknown',
      accepted: false,
      frames: recordFrames,
    }
    retainedWrites.push({
      filePath: sequencePath,
      bytes: Buffer.from(`${JSON.stringify(sequenceRecord, null, 2)}\n`),
      fault,
      faultName: 'asset',
    })
    const asset = createAssetRef({
      id: assetId,
      kind: 'static_image',
      name: documentName,
      revision: createAssetRevision({
        id: revisionId,
        sourceJobId: generatedSource?.jobId ?? null,
        createdAt: timestamp(now),
        qualityStatus: 'unknown',
        productionStatus: 'review_required',
        artifacts,
      }),
      provenance: generatedSource
        ? { source_type: 'provider', provider: generatedSource.provider, model: generatedSource.model }
        : { source_type: 'upload', provider: null, model: null },
    })
    const docPaths = resolveSpriteDocumentPaths({ projectId, documentId, projectRoot, workspaceRoot })
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await persistCommittedReferences({
      workspaceRoot: loaded.paths.workspaceRoot,
      fault,
      fileWrites: [
        ...retainedWrites,
        ...blocks.map((block) => ({
          filePath: spriteDocumentBlockPath(docPaths, block.sha256),
          bytes: block.bytes,
          fault,
          faultName: 'block',
        })),
        {
          filePath: spriteDocumentRevisionPath(docPaths, 1),
          bytes: manifestBytes,
          fault,
          faultName: 'manifest',
        },
      ],
    })
    const createdAt = timestamp(now)
    const next = clonePlain(project)
    next.revision += 1
    next.updated_at = createdAt
    next.assets[assetId] = asset
    attachDocumentCanvas(next, { documentId, canvasId, manifestSha: sha256Bytes(manifestBytes), createdAt })
    const receipt = makeReceipt({ operationId, payload, project: next, documentId, documentRevision: 1 })
    stageProjectReceipt(next, receipt)
    await publishV1ProjectJson(loaded.paths, next, { fault })
    if (fault === 'ack') throw spriteDocumentError('storage_commit_failed', 'acknowledgement failed after commit', { committed: true })
    return { project: next, receipt, document: manifest, sequence: sequenceRecord, replayed: false }
  })
}

export async function createSpriteDocumentFromMotionTimeline({
  projectId,
  operationId,
  expectedRevision,
  expectedSha256,
  sourceBytes = null,
  sourceFilePath = null,
  sourceKind = 'gif',
  sourceExt = 'gif',
  sourceMimeType = 'image/gif',
  sourceFileName = 'source.gif',
  extracted,
  name,
  payload,
  projectRoot = process.cwd(),
  workspaceRoot,
  now = new Date(),
  fault = null,
} = {}) {
  const documentId = deriveStableId('d', `sprite-doc-motion-timeline:${projectId}:${operationId}`)
  const canvasId = deriveStableId('c', `canvas:${projectId}:${documentId}`)
  const assetId = deriveStableId('a', `motion-timeline:${projectId}:${operationId}`)
  const revisionId = deriveStableId('r', `motion-timeline-rev:${projectId}:${operationId}`)
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    const project = assertV1Project(loaded.project)
    const existingReceipt = await receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot)
    if (existingReceipt) {
      const committed = await loadCommittedManifest(
        project,
        existingReceipt.document_id,
        existingReceipt.document_revision,
        projectRoot,
        workspaceRoot,
      )
      await confirmPublishedDurability(loaded.paths, [
        committed.paths.documentDir,
        committed.paths.revisionsDir,
        committed.paths.blocksDir,
      ])
      return {
        project,
        receipt: existingReceipt,
        document: committed.manifest,
        canvas: project.canvases[canvasId] ?? null,
        replayed: true,
      }
    }
    if (!extracted || !Array.isArray(extracted.frames) || extracted.frames.length < 1 || extracted.frames.length > SPRITE_DOCUMENT_LIMITS.maxFrames) {
      throw spriteDocumentError('invalid_request', `Motion timeline import requires 1 to ${SPRITE_DOCUMENT_LIMITS.maxFrames} frames.`)
    }
    if (project.revision !== expectedRevision) {
      throw spriteDocumentError('stale_revision', 'project revision does not match expected_revision', {
        expected_revision: expectedRevision,
        current_revision: project.revision,
      })
    }
    if (Object.keys(project.sprite_documents).length >= SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments
      || Object.keys(project.canvases).length >= SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments) {
      throw spriteDocumentError('resource_limit', 'project exceeds 64 canvases or documents')
    }
    let rawSourceBytes = Buffer.isBuffer(sourceBytes) ? sourceBytes : null
    if (!rawSourceBytes && sourceFilePath) {
      rawSourceBytes = await readFile(sourceFilePath)
    }
    if (!Buffer.isBuffer(rawSourceBytes) || rawSourceBytes.length < 12) {
      throw spriteDocumentError('unsupported_input', 'Motion source file could not be read.')
    }
    if (sha256Bytes(rawSourceBytes) !== expectedSha256) {
      throw spriteDocumentError('artifact_integrity_failed', 'source hash does not match expected_sha256')
    }
    const width = Number(extracted.width)
    const height = Number(extracted.height)
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
      throw spriteDocumentError('unsupported_input', 'Extracted motion frame dimensions are invalid.')
    }
    if (extracted.frames.length * width * height * 4 > SPRITE_DOCUMENT_LIMITS.maxExpandedRgbaBytes) {
      throw spriteDocumentError('resource_limit', 'expanded RGBA exceeds 128MiB', {
        limit: SPRITE_DOCUMENT_LIMITS.maxExpandedRgbaBytes,
      })
    }
    const documentName = name ?? DEFAULT_V1_DOCUMENT_NAME
    const imagePng = encodeRgbaPng(width, height, extracted.frames[0].rgba)
    const imageDigest = sha256Bytes(imagePng)
    const source = {
      asset_id: assetId,
      revision_id: revisionId,
      artifact: 'image',
      expected_sha256: imageDigest,
    }
    const { manifest, blocks } = buildManifestFromFrames({
      projectId,
      documentId,
      name: documentName,
      frames: extracted.frames.map((frame, index) => ({
        id: `frame_${index + 1}`,
        duration_ms: Math.min(60000, Math.max(1, Math.round(Number(frame.duration_ms) || 100))),
        rect: { x: 0, y: 0, w: width, h: height },
        rgba: frame.rgba,
      })),
      decoded: null,
      source,
    })
    let assetPaths
    try {
      assetPaths = resolveManagedAssetRevisionPaths({
        projectId,
        assetId,
        revisionId,
        projectRoot,
        workspaceRoot: loaded.paths.workspaceRoot,
      })
    } catch {
      throw spriteDocumentError('invalid_request', 'source path is unsafe')
    }
    const safeExt = /^[a-z0-9]{2,5}$/i.test(String(sourceExt || ''))
      ? String(sourceExt).toLowerCase()
      : (sourceKind === 'gif' ? 'gif' : 'mp4')
    const imagePath = path.join(assetPaths.revisionDir, 'image.png')
    const sequencePath = path.join(assetPaths.revisionDir, 'sequence.json')
    const sourceMediaPath = path.join(assetPaths.revisionDir, `source.${safeExt}`)
    const artifacts = {
      image: projectRelativePath(imagePath, { projectRoot: loaded.paths.projectRoot }),
      sequence: projectRelativePath(sequencePath, { projectRoot: loaded.paths.projectRoot }),
      source_media: projectRelativePath(sourceMediaPath, { projectRoot: loaded.paths.projectRoot }),
    }
    const recordFrames = extracted.frames.map((frame, index) => ({
      index,
      duration_ms: Math.min(60000, Math.max(1, Math.round(Number(frame.duration_ms) || 100))),
      timestamp_ms: Number.isFinite(frame.timestamp_ms) ? Math.round(frame.timestamp_ms) : 0,
      source_size: { w: frame.width, h: frame.height },
      working_sha256: sha256Bytes(frame.rgba),
    }))
    const sequenceRecord = {
      version: 1,
      method: sourceKind === 'gif' ? 'gif_timeline_v1' : 'video_timeline_v1',
      source_kind: sourceKind,
      source_file_name: String(sourceFileName || `source.${safeExt}`),
      source_mime_type: String(sourceMimeType || (sourceKind === 'gif' ? 'image/gif' : 'video/mp4')),
      source_sha256: expectedSha256,
      pixel_finishing: false,
      scaled: false,
      canvas: { w: width, h: height },
      grid_consistent: true,
      sampling: extracted.sampling || null,
      probe: extracted.probe || null,
      quality: 'unknown',
      accepted: false,
      frames: recordFrames,
    }
    const retainedWrites = [
      { filePath: imagePath, bytes: imagePng, fault, faultName: 'asset' },
      { filePath: sourceMediaPath, bytes: rawSourceBytes, fault, faultName: 'asset' },
      {
        filePath: sequencePath,
        bytes: Buffer.from(`${JSON.stringify(sequenceRecord, null, 2)}\n`),
        fault,
        faultName: 'asset',
      },
    ]
    const asset = createAssetRef({
      id: assetId,
      kind: 'static_image',
      name: documentName,
      revision: createAssetRevision({
        id: revisionId,
        sourceJobId: null,
        createdAt: timestamp(now),
        qualityStatus: 'pass',
        productionStatus: 'ready',
        artifacts,
      }),
      provenance: { source_type: 'upload', provider: null, model: null },
    })
    const docPaths = resolveSpriteDocumentPaths({ projectId, documentId, projectRoot, workspaceRoot })
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await persistCommittedReferences({
      workspaceRoot: loaded.paths.workspaceRoot,
      fault,
      fileWrites: [
        ...retainedWrites,
        ...blocks.map((block) => ({
          filePath: spriteDocumentBlockPath(docPaths, block.sha256),
          bytes: block.bytes,
          fault,
          faultName: 'block',
        })),
        {
          filePath: spriteDocumentRevisionPath(docPaths, 1),
          bytes: manifestBytes,
          fault,
          faultName: 'manifest',
        },
      ],
    })
    const createdAt = timestamp(now)
    const next = clonePlain(project)
    next.revision += 1
    next.updated_at = createdAt
    next.assets[assetId] = asset
    attachDocumentCanvas(next, { documentId, canvasId, manifestSha: sha256Bytes(manifestBytes), createdAt })
    const receipt = makeReceipt({ operationId, payload, project: next, documentId, documentRevision: 1 })
    stageProjectReceipt(next, receipt)
    await publishV1ProjectJson(loaded.paths, next, { fault })
    if (fault === 'ack') throw spriteDocumentError('storage_commit_failed', 'acknowledgement failed after commit', { committed: true })
    return { project: next, receipt, document: manifest, canvas: next.canvases[canvasId], sequence: sequenceRecord, replayed: false }
  })
}


export async function createSpriteDocumentFromUploadedJpeg({
  projectId,
  operationId,
  expectedRevision,
  expectedSha256,
  jpegBytes,
  generatedSource = null,
  name,
  payload,
  projectRoot = process.cwd(),
  workspaceRoot,
  now = new Date(),
  fault = null,
} = {}) {
  if (!Buffer.isBuffer(jpegBytes)) {
    throw spriteDocumentError('unsupported_input', 'source is not a JPEG')
  }
  if (jpegBytes.length > SPRITE_DOCUMENT_LIMITS.maxManagedPngBytes) {
    throw spriteDocumentError('resource_limit', 'managed JPEG exceeds 32MiB', {
      limit: SPRITE_DOCUMENT_LIMITS.maxManagedPngBytes,
    })
  }
  const digest = sha256Bytes(jpegBytes)
  if (digest !== expectedSha256) {
    throw spriteDocumentError('artifact_integrity_failed', 'source hash does not match expected_sha256')
  }
  await inspectUploadedJpeg(jpegBytes)
  const documentId = deriveStableId('d', `sprite-doc-upload-jpeg:${projectId}:${operationId}`)
  const canvasId = deriveStableId('c', `canvas:${projectId}:${documentId}`)
  const assetId = deriveStableId('a', `upload-jpeg:${projectId}:${operationId}`)
  const revisionId = deriveStableId('r', `upload-jpeg-rev:${projectId}:${operationId}`)
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    const project = assertV1Project(loaded.project)
    const existingReceipt = await receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot)
    if (!existingReceipt && generatedImageAlreadyImported(project, generatedSource)) {
      return { project, alreadyImported: true, replayed: true }
    }
    if (existingReceipt) {
      const committed = await loadCommittedManifest(
        project,
        existingReceipt.document_id,
        existingReceipt.document_revision,
        projectRoot,
        workspaceRoot,
      )
      const asset = project.assets?.[committed.manifest.source_ref?.asset_id]
      const revision = asset?.revisions?.[committed.manifest.source_ref?.revision_id]
      const extra = [committed.paths.documentDir, committed.paths.revisionsDir, committed.paths.blocksDir]
      if (asset && revision && committed.manifest.source_ref?.artifact === 'image') {
        try {
          const replayImage = await resolveManagedRevisionArtifactFile({
            projectId,
            assetId: asset.id,
            revision,
            artifactKey: 'image',
            projectRoot,
            workspaceRoot,
          })
          extra.push(path.dirname(replayImage))
        } catch (error) {
          if (error instanceof SpriteDocumentError) throw error
          if (error?.code === 'unsafe_artifact_path') {
            throw spriteDocumentError('invalid_request', 'source path is unsafe')
          }
          throw spriteDocumentError('artifact_integrity_failed', 'managed source could not be resolved')
        }
      }
      await confirmPublishedDurability(loaded.paths, extra)
      return {
        project,
        receipt: existingReceipt,
        document: committed.manifest,
        replayed: true,
      }
    }
    if (project.revision !== expectedRevision) {
      throw spriteDocumentError('stale_revision', 'project revision does not match expected_revision', {
        expected_revision: expectedRevision,
        current_revision: project.revision,
      })
    }
    if (Object.keys(project.sprite_documents).length >= SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments
      || Object.keys(project.canvases).length >= SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments) {
      throw spriteDocumentError('resource_limit', 'project exceeds 64 canvases or documents')
    }
    const decoded = await decodeJpegToRgba(jpegBytes)
    const documentName = name ?? DEFAULT_V1_DOCUMENT_NAME
    const source = {
      asset_id: assetId,
      revision_id: revisionId,
      artifact: 'image',
      expected_sha256: digest,
    }
    const { manifest, blocks } = buildManifestFromFrames({
      projectId,
      documentId,
      name: documentName,
      frames: [{
        id: 'frame_1',
        duration_ms: 1000,
        rect: { x: 0, y: 0, w: decoded.width, h: decoded.height },
      }],
      decoded,
      source,
    })
    if (manifest.derived_from != null) {
      throw spriteDocumentError('unsupported_input', 'JPEG import cannot set derived_from')
    }
    let assetPaths
    try {
      assetPaths = resolveManagedAssetRevisionPaths({
        projectId,
        assetId,
        revisionId,
        projectRoot,
        workspaceRoot: loaded.paths.workspaceRoot,
      })
    } catch {
      throw spriteDocumentError('invalid_request', 'source path is unsafe')
    }
    const imagePath = path.join(assetPaths.revisionDir, 'image.jpg')
    const relativeImage = projectRelativePath(imagePath, { projectRoot: loaded.paths.projectRoot })
    const asset = createAssetRef({
      id: assetId,
      kind: 'static_image',
      name: documentName,
      revision: createAssetRevision({
        id: revisionId,
        sourceJobId: generatedSource?.jobId ?? null,
        createdAt: timestamp(now),
        qualityStatus: 'pass',
        productionStatus: 'ready',
        artifacts: { image: relativeImage },
      }),
      provenance: generatedSource ? { source_type: 'provider', provider: generatedSource.provider, model: generatedSource.model }
        : { source_type: 'upload', provider: null, model: null },
    })
    const docPaths = resolveSpriteDocumentPaths({
      projectId,
      documentId,
      projectRoot,
      workspaceRoot,
    })
    const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`
    const manifestBytes = Buffer.from(manifestJson, 'utf8')
    const manifestSha = sha256Bytes(manifestBytes)
    await persistCommittedReferences({
      workspaceRoot: loaded.paths.workspaceRoot,
      fault,
      fileWrites: [
        {
          filePath: imagePath,
          bytes: jpegBytes,
          fault,
          faultName: 'asset',
        },
        ...blocks.map((block) => ({
          filePath: spriteDocumentBlockPath(docPaths, block.sha256),
          bytes: block.bytes,
          fault,
          faultName: 'block',
        })),
        {
          filePath: spriteDocumentRevisionPath(docPaths, 1),
          bytes: manifestBytes,
          fault,
          faultName: 'manifest',
        },
      ],
    })
    const createdAt = timestamp(now)
    const next = clonePlain(project)
    next.revision += 1
    next.updated_at = createdAt
    next.assets[assetId] = asset
    attachDocumentCanvas(next, { documentId, canvasId, manifestSha, createdAt })
    const receipt = makeReceipt({
      operationId,
      payload,
      project: next,
      documentId,
      documentRevision: 1,
    })
    stageProjectReceipt(next, receipt)
    await publishV1ProjectJson(loaded.paths, next, { fault })
    if (fault === 'ack') {
      throw spriteDocumentError('storage_commit_failed', 'acknowledgement failed after commit', { committed: true })
    }
    return { project: next, receipt, document: manifest, replayed: false }
  })
}

export async function createSpriteDocumentFromProcessedJob({
  projectId,
  operationId,
  expectedRevision,
  source,
  name,
  payload,
  loadCaptured,
  projectRoot = process.cwd(),
  workspaceRoot,
  now = new Date(),
  fault = null,
} = {}) {
  if (typeof loadCaptured !== 'function') {
    throw spriteDocumentError('invalid_request', 'from-job capture is unavailable')
  }
  const documentId = deriveStableId('d', `sprite-doc:${projectId}:${operationId}`)
  const canvasId = deriveStableId('c', `canvas:${projectId}:${documentId}`)
  const assetId = deriveStableId('a', `from-job:${projectId}:${operationId}`)
  const revisionId = 'rev_001'
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    const project = assertV1Project(loaded.project)
    const existingReceipt = await receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot)
    if (existingReceipt) {
      const committed = await loadCommittedManifest(
        project,
        existingReceipt.document_id,
        existingReceipt.document_revision,
        projectRoot,
        workspaceRoot,
      )
      const extra = [
        committed.paths.documentDir,
        committed.paths.revisionsDir,
        committed.paths.blocksDir,
      ]
      const sourceRef = committed.manifest?.source_ref
      if (sourceRef?.asset_id && sourceRef?.revision_id) {
        try {
          extra.push(resolveManagedAssetRevisionPaths({
            projectId,
            assetId: sourceRef.asset_id,
            revisionId: sourceRef.revision_id,
            projectRoot,
            workspaceRoot: loaded.paths.workspaceRoot,
          }).revisionDir)
        } catch {
          throw spriteDocumentError('artifact_integrity_failed', 'managed source could not be resolved')
        }
      }
      await confirmPublishedDurability(loaded.paths, extra)
      return {
        project,
        receipt: existingReceipt,
        document: committed.manifest,
        replayed: true,
      }
    }
    if (project.revision !== expectedRevision) {
      throw spriteDocumentError('stale_revision', 'project revision does not match expected_revision', {
        expected_revision: expectedRevision,
        current_revision: project.revision,
      })
    }
    if (Object.keys(project.sprite_documents).length >= SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments
      || Object.keys(project.canvases).length >= SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments) {
      throw spriteDocumentError('resource_limit', 'project exceeds 64 canvases or documents')
    }
    const captured = await loadCaptured()
    if (!Buffer.isBuffer(captured?.pngBytes) || captured.pngBytes.length === 0) {
      throw spriteDocumentError('artifact_not_found', 'process job sheet was not found')
    }
    if (captured.pngBytes.length > SPRITE_DOCUMENT_LIMITS.maxManagedPngBytes) {
      throw spriteDocumentError('resource_limit', 'managed PNG exceeds 32MiB', {
        limit: SPRITE_DOCUMENT_LIMITS.maxManagedPngBytes,
      })
    }
    const digest = sha256Bytes(captured.pngBytes)
    if (digest !== source.expected_sha256) {
      throw spriteDocumentError('artifact_integrity_failed', 'source hash does not match expected_sha256')
    }
    const decoded = decodePngToRgba(captured.pngBytes)
    const documentName = name ?? captured.name ?? DEFAULT_V1_DOCUMENT_NAME
    const documentSource = {
      asset_id: assetId,
      revision_id: revisionId,
      artifact: 'sheet',
      expected_sha256: digest,
    }
    const asset = createAssetRef({
      id: assetId,
      kind: 'character_pack',
      name: documentName,
      profile: captured.profile ?? 'topdown_rpg_v0',
      revision: createAssetRevision({
        id: revisionId,
        sourceJobId: source.job_id,
        createdAt: timestamp(now),
        qualityStatus: 'pass',
        productionStatus: 'ready',
        artifacts: {},
      }),
      provenance: captured.provenance ?? { source_type: 'manual_import', provider: null, model: null },
      clips: captured.clips ?? {},
    })
    const frames = buildFramesFromSource({
      decoded,
      asset,
      artifact: 'sheet',
      editorMetadata: captured.editorMetadata,
      requireSheetLayout: true,
      strictTiming: true,
    })
    for (const frame of frames) {
      if (frame.rect.w > SPRITE_DOCUMENT_LIMITS.maxCanvasEdge
        || frame.rect.h > SPRITE_DOCUMENT_LIMITS.maxCanvasEdge) {
        throw spriteDocumentError('resource_limit', 'canvas edge exceeds 4096', {
          limit: SPRITE_DOCUMENT_LIMITS.maxCanvasEdge,
        })
      }
    }
    const { manifest, blocks } = buildManifestFromFrames({
      projectId,
      documentId,
      name: documentName,
      frames,
      decoded,
      source: documentSource,
    })
    let assetPaths
    try {
      assetPaths = resolveManagedAssetRevisionPaths({
        projectId,
        assetId,
        revisionId,
        projectRoot,
        workspaceRoot: loaded.paths.workspaceRoot,
      })
    } catch {
      throw spriteDocumentError('invalid_request', 'source path is unsafe')
    }
    const sheetPath = path.join(assetPaths.revisionDir, 'normalized_sheet.png')
    const animationsPath = path.join(assetPaths.revisionDir, 'animations.json')
    const metadataPath = path.join(assetPaths.revisionDir, 'metadata.json')
    const editorMetadataPath = path.join(assetPaths.revisionDir, 'editor_metadata.json')
    const debugReportPath = path.join(assetPaths.revisionDir, 'debug_report.json')
    asset.revisions[revisionId].artifacts = {
      sheet: projectRelativePath(sheetPath, { projectRoot: loaded.paths.projectRoot }),
      animations: projectRelativePath(animationsPath, { projectRoot: loaded.paths.projectRoot }),
      metadata: projectRelativePath(metadataPath, { projectRoot: loaded.paths.projectRoot }),
      editor_metadata: projectRelativePath(editorMetadataPath, { projectRoot: loaded.paths.projectRoot }),
      debug_report: projectRelativePath(debugReportPath, { projectRoot: loaded.paths.projectRoot }),
    }
    const docPaths = resolveSpriteDocumentPaths({
      projectId,
      documentId,
      projectRoot,
      workspaceRoot,
    })
    const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`
    const manifestBytes = Buffer.from(manifestJson, 'utf8')
    const manifestSha = sha256Bytes(manifestBytes)
    await persistCommittedReferences({
      workspaceRoot: loaded.paths.workspaceRoot,
      fault,
      fileWrites: [
        {
          filePath: sheetPath,
          bytes: captured.pngBytes,
          fault,
          faultName: 'asset',
        },
        {
          filePath: animationsPath,
          bytes: captured.animationsBytes,
          fault,
          faultName: 'asset',
        },
        {
          filePath: metadataPath,
          bytes: captured.metadataBytes,
          fault,
          faultName: 'asset',
        },
        {
          filePath: editorMetadataPath,
          bytes: captured.editorMetadataBytes,
          fault,
          faultName: 'asset',
        },
        {
          filePath: debugReportPath,
          bytes: captured.debugReportBytes,
          fault,
          faultName: 'asset',
        },
        ...blocks.map((block) => ({
          filePath: spriteDocumentBlockPath(docPaths, block.sha256),
          bytes: block.bytes,
          fault,
          faultName: 'block',
        })),
        {
          filePath: spriteDocumentRevisionPath(docPaths, 1),
          bytes: manifestBytes,
          fault,
          faultName: 'manifest',
        },
      ],
    })
    const createdAt = timestamp(now)
    const next = clonePlain(project)
    next.revision += 1
    next.updated_at = createdAt
    next.assets[assetId] = asset
    attachDocumentCanvas(next, { documentId, canvasId, manifestSha, createdAt })
    const receipt = makeReceipt({
      operationId,
      payload,
      project: next,
      documentId,
      documentRevision: 1,
    })
    stageProjectReceipt(next, receipt)
    await publishV1ProjectJson(loaded.paths, next, { fault })
    if (fault === 'ack') {
      throw spriteDocumentError('storage_commit_failed', 'acknowledgement failed after commit', { committed: true })
    }
    return { project: next, receipt, document: manifest, replayed: false }
  })
}

export async function saveProjectPalette({ projectId, operationId, expectedRevision, colors, activeId, active_id, items,
  projectRoot = process.cwd(), workspaceRoot, now = new Date(), fault = null } = {}) {
  const resolvedActiveId = activeId ?? active_id
  const parsed = parseProjectPaletteRequest({
    operation_id: operationId,
    expected_revision: expectedRevision,
    colors,
    ...(resolvedActiveId !== undefined || items !== undefined ? { active_id: resolvedActiveId, items } : {}),
  })
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    const project = assertV1Project(loaded.project)
    const existingReceipt = await receiptFromProject(project, operationId, parsed.payload, projectRoot, workspaceRoot)
    if (existingReceipt) {
      await confirmPublishedDurability(loaded.paths)
      return { project, receipt: existingReceipt, replayed: true }
    }
    if (project.revision !== expectedRevision) throw spriteDocumentError('stale_revision', 'project revision does not match expected_revision', {
      expected_revision: expectedRevision, current_revision: project.revision,
    })
    const next = clonePlain(project)
    next.revision += 1
    next.updated_at = timestamp(now)
    const currentPalette = next.settings?.palette
    if (parsed.items) {
      next.settings.palette = { colors: parsed.colors, active_id: parsed.active_id, items: parsed.items }
    } else if (Array.isArray(currentPalette?.items) && currentPalette.items.length > 0 && currentPalette.active_id) {
      const activeId = currentPalette.items.some(item => item.id === currentPalette.active_id)
        ? currentPalette.active_id
        : currentPalette.items[0].id
      next.settings.palette = {
        colors: parsed.colors,
        active_id: activeId,
        items: currentPalette.items.map(item => (
          item.id === activeId
            ? { ...item, colors: parsed.colors.map(color => color.slice()) }
            : item
        )),
      }
    } else {
      next.settings.palette = { colors: parsed.colors }
    }
    const receipt = makeReceipt({ operationId, payload: parsed.payload, project: next, documentId: null, documentRevision: null })
    stageProjectReceipt(next, receipt)
    await publishV1ProjectJson(loaded.paths, next, { fault })
    if (fault === 'ack') throw spriteDocumentError('storage_commit_failed', 'acknowledgement failed after commit', { committed: true })
    return { project: next, receipt, replayed: false }
  })
}

export async function saveCanvasLayout({
  projectId,
  operationId,
  expectedRevision,
  positions,
  payload,
  projectRoot = process.cwd(),
  workspaceRoot,
  now = new Date(),
  fault = null,
} = {}) {
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    const project = assertV1Project(loaded.project)
    const existingReceipt = await receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot)
    if (existingReceipt) {
      await confirmPublishedDurability(loaded.paths)
      return { project, receipt: existingReceipt, replayed: true }
    }
    if (project.revision !== expectedRevision) {
      throw spriteDocumentError('stale_revision', 'project revision does not match expected_revision', {
        expected_revision: expectedRevision,
        current_revision: project.revision,
      })
    }
    for (const item of positions) {
      if (!Object.hasOwn(project.canvases ?? {}, item.canvas_id)) {
        throw spriteDocumentError('not_found', 'canvas does not belong to this project')
      }
    }
    const createdAt = timestamp(now)
    const next = clonePlain(project)
    next.revision += 1
    next.updated_at = createdAt
    for (const item of positions) {
      if (!Object.hasOwn(next.canvases, item.canvas_id)) {
        throw spriteDocumentError('not_found', 'canvas does not belong to this project')
      }
      next.canvases[item.canvas_id].x = item.x
      next.canvases[item.canvas_id].y = item.y
    }
    const receipt = makeReceipt({
      operationId,
      payload,
      project: next,
      documentId: null,
      documentRevision: null,
    })
    stageProjectReceipt(next, receipt)
    await publishV1ProjectJson(loaded.paths, next, { fault })
    if (fault === 'ack') {
      throw spriteDocumentError('storage_commit_failed', 'acknowledgement failed after commit', { committed: true })
    }
    return { project: next, receipt, replayed: false }
  })
}

export async function renameCanvas({
  projectId,
  canvasId,
  operationId,
  expectedRevision,
  displayName,
  payload,
  projectRoot = process.cwd(),
  workspaceRoot,
  now = new Date(),
  fault = null,
} = {}) {
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    const project = assertV1Project(loaded.project)
    const existingReceipt = await receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot)
    if (existingReceipt) {
      await confirmPublishedDurability(loaded.paths)
      return { project, receipt: existingReceipt, replayed: true }
    }
    if (project.revision !== expectedRevision) {
      throw spriteDocumentError('stale_revision', 'project revision does not match expected_revision', {
        expected_revision: expectedRevision,
        current_revision: project.revision,
      })
    }
    if (!Object.hasOwn(project.canvases ?? {}, canvasId)) {
      throw spriteDocumentError('not_found', 'canvas does not belong to this project')
    }
    const createdAt = timestamp(now)
    const next = clonePlain(project)
    next.revision += 1
    next.updated_at = createdAt
    const canvas = next.canvases[canvasId]
    if (!canvas) throw spriteDocumentError('not_found', 'canvas does not belong to this project')
    canvas.display_name = displayName
    const receipt = makeReceipt({
      operationId,
      payload,
      project: next,
      documentId: null,
      documentRevision: null,
    })
    stageProjectReceipt(next, receipt)
    await publishV1ProjectJson(loaded.paths, next, { fault })
    if (fault === 'ack') {
      throw spriteDocumentError('storage_commit_failed', 'acknowledgement failed after commit', { committed: true })
    }
    return { project: next, receipt, replayed: false }
  })
}

function canvasPlacement(project, canvasId) {
  for (const page of project.pages || []) {
    const index = page.canvas_order?.indexOf(canvasId) ?? -1
    if (index >= 0) return { page, index }
  }
  return null
}

export async function resetCanvasName({
  projectId,
  canvasId,
  operationId,
  expectedRevision,
  payload,
  projectRoot = process.cwd(),
  workspaceRoot,
  now = new Date(),
  fault = null,
} = {}) {
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    const project = assertV1Project(loaded.project)
    const existingReceipt = await receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot)
    if (existingReceipt) {
      await confirmPublishedDurability(loaded.paths)
      return { project, receipt: existingReceipt, replayed: true }
    }
    if (project.revision !== expectedRevision) {
      throw spriteDocumentError('stale_revision', 'project revision does not match expected_revision', {
        expected_revision: expectedRevision,
        current_revision: project.revision,
      })
    }
    if (!Object.hasOwn(project.canvases ?? {}, canvasId)) {
      throw spriteDocumentError('not_found', 'canvas does not belong to this project')
    }
    const createdAt = timestamp(now)
    const next = clonePlain(project)
    next.revision += 1
    next.updated_at = createdAt
    delete next.canvases[canvasId].display_name
    const receipt = makeReceipt({
      operationId,
      payload,
      project: next,
      documentId: null,
      documentRevision: null,
    })
    stageProjectReceipt(next, receipt)
    await publishV1ProjectJson(loaded.paths, next, { fault })
    if (fault === 'ack') {
      throw spriteDocumentError('storage_commit_failed', 'acknowledgement failed after commit', { committed: true })
    }
    return { project: next, receipt, replayed: false }
  })
}

export async function detachCanvas({
  projectId,
  canvasId,
  operationId,
  expectedRevision,
  payload,
  projectRoot = process.cwd(),
  workspaceRoot,
  now = new Date(),
  fault = null,
} = {}) {
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    const project = assertV1Project(loaded.project)
    const existingReceipt = await receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot)
    if (existingReceipt) {
      await confirmPublishedDurability(loaded.paths)
      return { project, receipt: existingReceipt, replayed: true }
    }
    if (project.revision !== expectedRevision) {
      throw spriteDocumentError('stale_revision', 'project revision does not match expected_revision', {
        expected_revision: expectedRevision,
        current_revision: project.revision,
      })
    }
    const canvas = project.canvases?.[canvasId]
    if (!canvas) throw spriteDocumentError('not_found', 'canvas does not belong to this project')
    const placement = canvasPlacement(project, canvasId)
    if (!placement) throw spriteDocumentError('not_found', 'canvas is not on a page')
    const createdAt = timestamp(now)
    const next = clonePlain(project)
    next.revision += 1
    next.updated_at = createdAt
    const removed = clonePlain(next.canvases[canvasId])
    delete next.canvases[canvasId]
    next.pages.find((page) => page.id === placement.page.id).canvas_order.splice(placement.index, 1)
    const receipt = makeReceipt({
      operationId,
      payload,
      project: next,
      documentId: removed.document_id,
      documentRevision: null,
    })
    receipt.detached_canvas = {
      canvas: removed,
      page_id: placement.page.id,
      order_index: placement.index,
    }
    stageProjectReceipt(next, receipt)
    await publishV1ProjectJson(loaded.paths, next, { fault })
    if (fault === 'ack') {
      throw spriteDocumentError('storage_commit_failed', 'acknowledgement failed after commit', { committed: true })
    }
    return { project: next, receipt, replayed: false }
  })
}

export async function restoreCanvas({
  projectId,
  canvasId,
  operationId,
  expectedRevision,
  detachOperationId,
  payload,
  projectRoot = process.cwd(),
  workspaceRoot,
  now = new Date(),
  fault = null,
} = {}) {
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    const project = assertV1Project(loaded.project)
    const existingReceipt = await receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot)
    if (existingReceipt) {
      await confirmPublishedDurability(loaded.paths)
      return { project, receipt: existingReceipt, replayed: true }
    }
    if (project.revision !== expectedRevision) {
      throw spriteDocumentError('stale_revision', 'project revision does not match expected_revision', {
        expected_revision: expectedRevision,
        current_revision: project.revision,
      })
    }
    const detach = await lookupProjectReceipt(project, detachOperationId, { projectRoot, workspaceRoot })
    const recorded = detach?.detached_canvas
    if (!detach || !recorded?.canvas || recorded.canvas.id !== canvasId) {
      throw spriteDocumentError('not_found', 'detach operation does not record this canvas')
    }
    if (project.canvases?.[canvasId]) {
      throw spriteDocumentError('operation_conflict', 'canvas is already present')
    }
    if (!project.sprite_documents?.[recorded.canvas.document_id]) {
      throw spriteDocumentError('not_found', 'recorded document is not in this project')
    }
    const page = project.pages?.find((item) => item.id === recorded.page_id)
    if (!page) throw spriteDocumentError('not_found', 'recorded page is not in this project')
    if (Object.keys(project.canvases).length >= SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments) {
      throw spriteDocumentError('resource_limit', 'project exceeds 64 canvases or documents', {
        limit: SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments,
      })
    }
    const createdAt = timestamp(now)
    const next = clonePlain(project)
    next.revision += 1
    next.updated_at = createdAt
    next.canvases[canvasId] = clonePlain(recorded.canvas)
    const order = next.pages.find((item) => item.id === recorded.page_id).canvas_order
    const index = Math.min(Math.max(0, recorded.order_index), order.length)
    order.splice(index, 0, canvasId)
    const receipt = makeReceipt({
      operationId,
      payload,
      project: next,
      documentId: recorded.canvas.document_id,
      documentRevision: null,
    })
    stageProjectReceipt(next, receipt)
    await publishV1ProjectJson(loaded.paths, next, { fault })
    if (fault === 'ack') {
      throw spriteDocumentError('storage_commit_failed', 'acknowledgement failed after commit', { committed: true })
    }
    return { project: next, receipt, replayed: false }
  })
}

const WORKING_PIXELS_MAX_BYTES = 4 * 1024 * 1024

function assertSingleCel(manifest) {
  const frames = manifest?.frame_order ?? []
  const layers = manifest?.layer_order ?? []
  const cels = Object.values(manifest?.cels ?? {})
  if (frames.length !== 1 || layers.length !== 1 || cels.length !== 1 || (!cels[0]?.block && !isBlankSpriteDocument(manifest))) {
    throw spriteDocumentError('unsupported_input', 'pixel working document requires one complete frame and layer')
  }
  const layer = manifest.layers?.[layers[0]]
  const cel = cels[0]
  if (!layer || (cel.block && (cel.block.w !== manifest.canvas?.w || cel.block.h !== manifest.canvas?.h))) {
    throw spriteDocumentError('unsupported_input', 'cel does not cover the canvas')
  }
  return { cel, layer }
}

function assertPixelStructure(...args) {
  try { return validatePixelStructure(...args) } catch (error) { throw spriteDocumentError('unsupported_input', error.message) }
}
function applyStructureCommand(...args) {
  try { return mutatePixelStructure(...args) } catch (error) { throw spriteDocumentError(error.code === 'resource_limit' ? 'resource_limit' : 'unsupported_input', error.message) }
}

function assertWritableDerived(manifest, target, project = null) {
  if (!target && Object.keys(manifest.links?.groups || {}).length) throw spriteDocumentError('unsupported_input', 'Linked cels require an explicit target and group authorization.')
  let checked
  try { checked = target ? pixelDocumentTarget(manifest, target, { writable: true }) : assertSingleCel(manifest) }
  catch (error) { throw spriteDocumentError('unsupported_input', error.message) }
  if (checked.layer.locked) {
    throw spriteDocumentError('unsupported_input', 'locked layer cannot be edited')
  }
  const from = manifest.derived_from
  if (!isBlankSpriteDocument(manifest) && !isGeneralSequenceSpriteDocument(manifest, project) && (!from || !isValidId(from.document_id) || !isPositiveInteger(from.revision) || !isSha256Hex(from.manifest_sha256))) {
    throw spriteDocumentError('unsupported_input', 'working pixels require a derived working document')
  }
  return checked
}

async function readCelBytes(manifest, paths, target) {
  const { cel } = target ? pixelDocumentTarget(manifest, target) : assertSingleCel(manifest)
  if (!cel.block) return Buffer.alloc(manifest.canvas.w * manifest.canvas.h * 4)
  const bytes = await readV1Bytes(spriteDocumentBlockPath(paths, cel.block.sha256), 'block')
  if (sha256Bytes(bytes) !== cel.block.sha256 || bytes.length !== cel.block.w * cel.block.h * 4) {
    throw spriteDocumentError('artifact_integrity_failed', 'block hash does not match the committed cel')
  }
  return bytes
}

function rectanglesOverlap(left, right) {
  return left.x < right.x + right.w
    && left.x + left.w > right.x
    && left.y < right.y + right.h
    && left.y + left.h > right.y
}

function placeWorkingCanvas(sourceCanvas, size, canvases, sizes, sourceWidth = size.w) {
  const others = Object.values(canvases)
    .filter((item) => item.page_id === sourceCanvas.page_id && item.id !== sourceCanvas.id)
    .slice(0, SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments)
  let x = sourceCanvas.x + sourceWidth
  const y = sourceCanvas.y
  for (let step = 0; step <= others.length; step += 1) {
    if (!Number.isSafeInteger(x)) {
      throw spriteDocumentError('resource_limit', 'canvas position exceeds a safe integer')
    }
    const hit = others.find((item) => {
      const hitSize = sizes.get(item.document_id)
      if (!hitSize) return false
      return rectanglesOverlap(
        { x, y, w: size.w, h: size.h },
        { x: item.x, y: item.y, w: hitSize.w, h: hitSize.h },
      )
    })
    if (!hit) return { x, y }
    x = hit.x + sizes.get(hit.document_id).w
  }
  throw spriteDocumentError('resource_limit', 'no free canvas position within 64 boards', {
    limit: SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments,
  })
}

async function writeBlockIfAbsent({ workspaceRoot, paths, sha256, bytes, fault }) {
  const filePath = spriteDocumentBlockPath(paths, sha256)
  let reuse = false
  try {
    const existing = await readV1Bytes(filePath, 'block')
    if (sha256Bytes(existing) !== sha256 || existing.length !== bytes.length) {
      throw spriteDocumentError('artifact_integrity_failed', 'existing block does not match its identity')
    }
    reuse = true
  } catch (error) {
    if (!(error instanceof SpriteDocumentError) || error.code !== 'not_found') throw error
  }
  await persistCommittedReferences({
    workspaceRoot,
    fault: reuse ? null : fault,
    fileWrites: [{
      filePath,
      bytes,
      fault: reuse ? null : fault,
      faultName: reuse ? null : 'block',
      syncFault: !reuse && fault === 'block_sync' ? 'publish' : null,
    }],
  })
}

function appendWorkingRevision(project, documentId, { manifestSha, createdAt, parentRevision, revision }) {
  const record = project.sprite_documents[documentId]
  record.revisions ??= {}
  if (record.revisions[String(revision)]) {
    throw spriteDocumentError('artifact_integrity_failed', 'committed revision cannot be replaced')
  }
  record.revisions[String(revision)] = {
    manifest_sha256: manifestSha,
    parent_revision: parentRevision,
    created_at: createdAt,
  }
  record.working_revision = revision
  return revision
}

async function resolveRevisionSlot(record, paths, manifestFor) {
  const committedMax = record.max_revision ?? Math.max(...Object.keys(record.revisions).map((key) => Number(key)))
  if (!Number.isSafeInteger(committedMax) || committedMax >= Number.MAX_SAFE_INTEGER) {
    throw spriteDocumentError('resource_limit', 'document revision exceeds safe integer range')
  }
  const limit = committedMax + SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments
  for (let revision = committedMax + 1; revision <= limit; revision += 1) {
    const filePath = spriteDocumentRevisionPath(paths, revision)
    const manifest = manifestFor(revision)
    const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    if (record.revisions?.[String(revision)]) {
      throw spriteDocumentError('artifact_integrity_failed', 'committed revision cannot be replaced')
    }
    try {
      const existing = await readV1Bytes(filePath, 'manifest')
      if (existing.equals(bytes)) return { revision, manifest, bytes, reuse: true }
    } catch (error) {
      if (error instanceof SpriteDocumentError && error.code === 'not_found') {
        return { revision, manifest, bytes, reuse: false }
      }
      throw error
    }
  }
  throw spriteDocumentError('resource_limit', 'uncommitted revision slots exceed the document budget', {
    limit: SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments,
  })
}

export async function deriveWorkingSpriteDocument({
  projectId,
  operationId,
  expectedRevision,
  sourceCanvasId,
  sourceDocumentId,
  sourceRevision,
  name,
  payload,
  projectRoot = process.cwd(),
  workspaceRoot,
  now = new Date(),
  fault = null,
  documentCandidate = null,
} = {}) {
  const documentId = deriveStableId('d', `derive-working:${projectId}:${operationId}`)
  const canvasId = deriveStableId('c', `canvas:${projectId}:${documentId}`)
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    const project = assertV1Project(loaded.project)
    const existingReceipt = await receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot)
    if (existingReceipt) {
      const committed = await loadCommittedManifest(
        project,
        existingReceipt.document_id,
        existingReceipt.document_revision,
        projectRoot,
        workspaceRoot,
      )
      const canvas = Object.values(project.canvases).find((item) => item.document_id === existingReceipt.document_id) ?? null
      if (!canvas) throw spriteDocumentError('not_found', 'derived canvas was not found')
      await confirmPublishedDurability(loaded.paths, [
        committed.paths.documentDir,
        committed.paths.revisionsDir,
        committed.paths.blocksDir,
      ])
      return { project, receipt: existingReceipt, document: committed.manifest, canvas, replayed: true }
    }
    if (project.revision !== expectedRevision) {
      throw spriteDocumentError('stale_revision', 'project revision does not match expected_revision', {
        expected_revision: expectedRevision,
        current_revision: project.revision,
      })
    }
    const sourceCanvas = project.canvases?.[sourceCanvasId]
    if (!sourceCanvas) throw spriteDocumentError('not_found', 'source canvas was not found')
    if (sourceCanvas.document_id !== sourceDocumentId) {
      throw spriteDocumentError('invalid_request', 'source canvas does not point at the source document')
    }
    const sourceRecord = project.sprite_documents?.[sourceDocumentId]
    if (!sourceRecord || !(await lookupProjectRevision(project, sourceDocumentId, sourceRevision, { projectRoot, workspaceRoot }))) {
      throw spriteDocumentError('not_found', 'source document revision was not found')
    }
    if (sourceRecord.working_revision !== sourceRevision) {
      throw spriteDocumentError('stale_revision', 'source revision is not the current working revision', {
        expected_revision: sourceRecord.working_revision,
        current_revision: sourceRevision,
      })
    }
    if (Object.keys(project.sprite_documents).length >= SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments
      || Object.keys(project.canvases).length >= SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments) {
      throw spriteDocumentError('resource_limit', 'project exceeds 64 canvases or documents')
    }
    const source = await loadCommittedManifest(project, sourceDocumentId, sourceRevision, projectRoot, workspaceRoot)
    assertPixelStructure(source.manifest)
    const sizes = new Map([[sourceDocumentId, { w: source.manifest.canvas.w, h: source.manifest.canvas.h }]])
    const samePage = Object.values(project.canvases)
      .filter((item) => item.page_id === sourceCanvas.page_id && item.id !== sourceCanvas.id)
      .slice(0, SPRITE_DOCUMENT_LIMITS.maxCanvasesOrDocuments)
    for (const item of samePage) {
      if (sizes.has(item.document_id)) continue
      const other = await loadCommittedManifest(project, item.document_id, null, projectRoot, workspaceRoot)
      sizes.set(item.document_id, { w: other.manifest.canvas.w, h: other.manifest.canvas.h })
    }
    const position = placeWorkingCanvas(sourceCanvas, documentCandidate?.document.canvas || sizes.get(sourceDocumentId), project.canvases, sizes, source.manifest.canvas.w)
    const page = project.pages.find((item) => item.id === sourceCanvas.page_id)
    if (!page) throw spriteDocumentError('not_found', 'source page was not found')
    const manifest = {
      ...clonePlain(source.manifest),
      version: SPRITE_DOCUMENT_VERSION,
      document_id: documentId,
      project_id: projectId,
      name: name ?? source.manifest.name,
      revision: 1,
      parent_revision: null,
      canvas: { w: source.manifest.canvas.w, h: source.manifest.canvas.h },
      color: clonePlain(source.manifest.color),
      source_ref: clonePlain(source.manifest.source_ref),
      derived_from: {
        document_id: sourceDocumentId,
        revision: sourceRevision,
        manifest_sha256: source.manifest_sha256,
      },
    }
    if (documentCandidate) applyDocumentCandidate(manifest, documentCandidate, source.manifest)
    assertValidSpriteDocument(manifest)
    const docPaths = resolveSpriteDocumentPaths({ projectId, documentId, projectRoot, workspaceRoot })
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    const manifestSha = sha256Bytes(manifestBytes)
    const copiedBlocks = new Set()
    for (const cel of Object.values(manifest.cels)) {
      if (!cel.block || copiedBlocks.has(cel.block.sha256)) continue
      const bytes = documentCandidate ? documentCandidate.blocks.get(cel.block.sha256) : await readCelBytes(source.manifest, source.paths, { frame_id: cel.frame_id, layer_id: cel.layer_id, cel_id: cel.id })
      await writeBlockIfAbsent({ workspaceRoot: loaded.paths.workspaceRoot, paths: docPaths, sha256: cel.block.sha256, bytes, fault })
      copiedBlocks.add(cel.block.sha256)
    }
    await persistCommittedReferences({
      workspaceRoot: loaded.paths.workspaceRoot,
      fault,
      fileWrites: [{
        filePath: spriteDocumentRevisionPath(docPaths, 1),
        bytes: manifestBytes,
        fault,
        faultName: 'manifest',
      }],
    })
    const createdAt = timestamp(now)
    const next = clonePlain(project)
    next.revision += 1
    next.updated_at = createdAt
    next.sprite_documents[documentId] = {
      id: documentId,
      working_revision: 1,
      accepted_revision: null,
      revisions: {
        1: { manifest_sha256: manifestSha, parent_revision: null, created_at: createdAt },
      },
    }
    next.canvases[canvasId] = {
      id: canvasId,
      page_id: sourceCanvas.page_id,
      document_id: documentId,
      x: position.x,
      y: position.y,
    }
    next.pages.find((item) => item.id === sourceCanvas.page_id).canvas_order.push(canvasId)
    const receipt = makeReceipt({
      operationId,
      payload,
      project: next,
      documentId,
      documentRevision: 1,
    })
    stageProjectReceipt(next, receipt)
    await publishV1ProjectJson(loaded.paths, next, { fault })
    if (fault === 'ack') {
      throw spriteDocumentError('storage_commit_failed', 'acknowledgement failed after commit', { committed: true })
    }
    return {
      project: next,
      receipt,
      document: manifest,
      canvas: next.canvases[canvasId],
      replayed: false,
    }
  })
}

async function commitDerivedRevision({
  projectId,
  documentId,
  operationId,
  expectedRevision,
  expectedWorkingRevision,
  payload,
  projectRoot,
  workspaceRoot,
  now,
  fault,
  nextPixels,
  target,
  structure,
  prepareStructure,
  documentCandidate,
}) {
  const run = async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    const project = assertV1Project(loaded.project)
    const existingReceipt = await receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot)
    if (existingReceipt) {
      const committed = await loadCommittedManifest(
        project,
        existingReceipt.document_id,
        existingReceipt.document_revision,
        projectRoot,
        workspaceRoot,
      )
      await confirmPublishedDurability(loaded.paths, [
        committed.paths.documentDir,
        committed.paths.revisionsDir,
        committed.paths.blocksDir,
      ])
      return { project, receipt: existingReceipt, document: committed.manifest, replayed: true }
    }
    if (project.revision !== expectedRevision) {
      throw spriteDocumentError('stale_revision', 'project revision does not match expected_revision', {
        expected_revision: expectedRevision,
        current_revision: project.revision,
      })
    }
    const record = project.sprite_documents?.[documentId]
    if (!record) throw spriteDocumentError('not_found', 'sprite document was not found')
    if (record.working_revision !== expectedWorkingRevision) {
      throw spriteDocumentError('stale_revision', 'working revision does not match expected_working_revision', {
        expected_revision: expectedWorkingRevision,
        current_revision: record.working_revision,
      })
    }
    const current = await loadCommittedManifest(project, documentId, record.working_revision, projectRoot, workspaceRoot)
    structure ||= documentCandidate ? () => documentCandidate.document : null
    const selected = (structure || prepareStructure) ? (assertPixelStructure(current.manifest, { derived: true, project }), null) : assertWritableDerived(current.manifest, target, project)
    let preparedBlocks = null
    if (prepareStructure) {
      const prepared = await prepareStructure(current, project)
      structure = prepared.structure
      preparedBlocks = prepared.blocks || null
    }
    const createdAt = timestamp(now)
    const digest = structure ? null : sha256Bytes(nextPixels)
    const slot = await resolveRevisionSlot(record, current.paths, (revision) => {
      const manifest = clonePlain(current.manifest)
      manifest.revision = revision
      manifest.parent_revision = record.working_revision
      if (documentCandidate) {
        applyDocumentCandidate(manifest, documentCandidate, current.manifest)
        assertPixelStructure(manifest, { derived: true, project })
      } else if (structure) {
        const updated = structure(current.manifest, project)
        for (const key of ['canvas', ...PIXEL_STRUCTURE_FIELDS]) {
          if (Object.hasOwn(updated, key)) manifest[key] = clonePlain(updated[key])
          else if (key === 'tags') manifest.tags = Array.isArray(manifest.tags) ? manifest.tags : []
          else delete manifest[key]
        }
        assertPixelStructure(manifest, { derived: true, project })
      } else {
        const members = pixelLinkScope(manifest, selected.cel.id)?.cel_ids || [selected.cel.id]
        for (const celId of members) manifest.cels[celId].block = { sha256: digest, w: manifest.canvas.w, h: manifest.canvas.h }
      }
      assertValidSpriteDocument(manifest)
      return manifest
    })
    if (documentCandidate) applyDocumentCandidate(slot.manifest, documentCandidate, current.manifest)
    const manifestSha = sha256Bytes(slot.bytes)
    if (documentCandidate) for (const [sha256, bytes] of documentCandidate.blocks) await writeBlockIfAbsent({ workspaceRoot: loaded.paths.workspaceRoot, paths: current.paths, sha256, bytes: Buffer.from(bytes), fault })
    if (preparedBlocks) for (const [sha256, bytes] of preparedBlocks) await writeBlockIfAbsent({ workspaceRoot: loaded.paths.workspaceRoot, paths: current.paths, sha256, bytes: Buffer.from(bytes), fault })
    if (!structure) await writeBlockIfAbsent({
      workspaceRoot: loaded.paths.workspaceRoot,
      paths: current.paths,
      sha256: digest,
      bytes: Buffer.from(nextPixels),
      fault,
    })
    await persistCommittedReferences({
      workspaceRoot: loaded.paths.workspaceRoot,
      fault: slot.reuse ? null : fault,
      fileWrites: [{
        filePath: spriteDocumentRevisionPath(current.paths, slot.revision),
        bytes: slot.bytes,
        fault: slot.reuse ? null : fault,
        faultName: slot.reuse ? null : 'manifest',
        syncFault: !slot.reuse && fault === 'manifest_sync' ? 'publish' : null,
      }],
    })
    const next = clonePlain(project)
    next.revision += 1
    next.updated_at = createdAt
    appendWorkingRevision(next, documentId, {
      manifestSha,
      createdAt,
      parentRevision: record.working_revision,
      revision: slot.revision,
    })
    const receipt = makeReceipt({
      operationId,
      payload,
      project: next,
      documentId,
      documentRevision: slot.revision,
    })
    stageProjectReceipt(next, receipt)
    await publishV1ProjectJson(loaded.paths, next, { fault })
    if (fault === 'ack') {
      throw spriteDocumentError('storage_commit_failed', 'acknowledgement failed after commit', { committed: true })
    }
    return { project: next, receipt, document: slot.manifest, replayed: false }
  }
  return run()
}

export async function writeWorkingPixels({
  projectId,
  documentId,
  operationId,
  expectedRevision,
  expectedWorkingRevision,
  rect,
  rgba,
  expectedSha256,
  target,
  grantId,
  commandSha256,
  payload,
  projectRoot = process.cwd(),
  workspaceRoot,
  now = new Date(),
  fault = null,
} = {}) {
  if (!(rgba instanceof Uint8Array)) {
    throw spriteDocumentError('invalid_request', 'working pixels require raw RGBA8 bytes')
  }
  const expectedLength = rect.w * rect.h * 4
  if (expectedLength > WORKING_PIXELS_MAX_BYTES || rgba.byteLength > WORKING_PIXELS_MAX_BYTES) {
    throw spriteDocumentError('resource_limit', 'working pixels exceed 4MiB', {
      limit: WORKING_PIXELS_MAX_BYTES,
    })
  }
  if (rgba.byteLength !== expectedLength) {
    throw spriteDocumentError('invalid_request', 'working pixels length does not match the rectangle')
  }
  if (sha256Bytes(rgba) !== expectedSha256) {
    throw spriteDocumentError('artifact_integrity_failed', 'working pixels hash does not match expected_sha256')
  }
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    const project = assertV1Project(loaded.project)
    const existingReceipt = await receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot)
    if (existingReceipt) {
      const committed = await loadCommittedManifest(
        project,
        existingReceipt.document_id,
        existingReceipt.document_revision,
        projectRoot,
        workspaceRoot,
      )
      await confirmPublishedDurability(loaded.paths, [
        committed.paths.documentDir,
        committed.paths.revisionsDir,
        committed.paths.blocksDir,
      ])
      return { project, receipt: existingReceipt, document: committed.manifest, replayed: true }
    }
    if (project.revision !== expectedRevision) {
      throw spriteDocumentError('stale_revision', 'project revision does not match expected_revision', {
        expected_revision: expectedRevision,
        current_revision: project.revision,
      })
    }
    const record = project.sprite_documents?.[documentId]
    if (!record) throw spriteDocumentError('not_found', 'sprite document was not found')
    if (record.working_revision !== expectedWorkingRevision) {
      throw spriteDocumentError('stale_revision', 'working revision does not match expected_working_revision', {
        expected_revision: expectedWorkingRevision,
        current_revision: record.working_revision,
      })
    }
    const current = await loadCommittedManifest(project, documentId, record.working_revision, projectRoot, workspaceRoot)
    assertWritableDerived(current.manifest, target, project)
    if (grantId || commandSha256 || pixelLinkScope(current.manifest, target?.cel_id)) await checkScopedPixelWrite({ projectId, projectRoot, workspaceRoot }, project, current.manifest,
      { grantId, commandSha256, target, rect, expectedSha256 })
    const currentBytes = await readCelBytes(current.manifest, current.paths, target)
    const working = createPixelWorkingCopy({
      width: current.manifest.canvas.w,
      height: current.manifest.canvas.h,
      rgba: currentBytes,
    })
    modifyPixelWorkingCopy(working, rect, rgba)
    return commitDerivedRevision({
      projectId,
      documentId,
      operationId,
      expectedRevision,
      expectedWorkingRevision,
      payload,
      projectRoot,
      workspaceRoot,
      now,
      fault,
      nextPixels: working.pixels(),
      target,
    })
  })
}

// Internal candidates come from the bounded document tool session, never from HTTP manifests.
function applyDocumentCandidate(manifest, candidate, sourceManifest = null) {
  for (const key of ['canvas', ...PIXEL_STRUCTURE_FIELDS]) {
    if (Object.hasOwn(candidate.document, key)) manifest[key] = clonePlain(candidate.document[key])
    else if (key === 'tags') manifest.tags = Array.isArray(manifest.tags) ? manifest.tags : []
    else delete manifest[key]
  }
  assertPixelStructure(manifest)
  if (sourceManifest && candidate.editableFrameIds) {
    assertScopedDocumentCandidate(sourceManifest, manifest, candidate.editableFrameIds)
  }
  assertDocumentLimits(manifest)
  for (const cel of Object.values(manifest.cels)) if (cel.block) {
    const bytes = candidate.blocks.get(cel.block.sha256)
    if (!(bytes instanceof Uint8Array) || bytes.length !== manifest.canvas.w * manifest.canvas.h * 4 || sha256Bytes(bytes) !== cel.block.sha256) {
      throw spriteDocumentError('artifact_integrity_failed', 'Candidate block is invalid.')
    }
  }
}

export async function promoteProjectReference({
  projectId,
  operationId,
  expectedRevision,
  canvasId,
  documentId,
  workingRevision,
  frameId,
  layerId = null,
  sourceKind = 'frame_composite',
  purpose = 'frame',
  name = null,
  payload,
  projectRoot = process.cwd(),
  workspaceRoot,
  now = new Date(),
  fault = null,
} = {}) {
  const referenceId = deriveStableId('ref_', `reference:${projectId}:${operationId}`)
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    const project = assertV1Project(loaded.project)
    const existingReceipt = await receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot)
    if (existingReceipt) {
      const existingReference = (project.references ?? []).find(item => item?.id === referenceId || item?.operation_id === operationId) ?? null
      await confirmPublishedDurability(loaded.paths)
      return { project, receipt: existingReceipt, reference: existingReference, replayed: true }
    }
    if (project.revision !== expectedRevision) {
      throw spriteDocumentError('stale_revision', 'project revision does not match expected_revision', {
        expected_revision: expectedRevision,
        current_revision: project.revision,
      })
    }
    const canvas = project.canvases?.[canvasId]
    if (!canvas || canvas.document_id !== documentId) {
      throw spriteDocumentError('stale_revision', 'source canvas does not point at the source document')
    }
    const record = project.sprite_documents?.[documentId]
    if (!record) throw spriteDocumentError('not_found', 'source sprite document was not found')
    if (record.working_revision !== workingRevision) {
      throw spriteDocumentError('stale_revision', 'working revision does not match source working_revision', {
        expected_revision: workingRevision,
        current_revision: record.working_revision,
      })
    }
    const existingRefs = Array.isArray(project.references) ? project.references : []
    const maxRefs = SPRITE_DOCUMENT_LIMITS.maxProjectReferences ?? 64
    if (existingRefs.length >= maxRefs) {
      throw spriteDocumentError('resource_limit', `Project reference library is full (maximum ${maxRefs} references).`, {
        limit: maxRefs,
      })
    }
    const committed = await loadCommittedManifest(project, documentId, workingRevision, projectRoot, workspaceRoot)
    const manifest = committed.manifest
    assertPixelStructure(manifest)
    if (manifest.canvas.w > 1024 || manifest.canvas.h > 1024) {
      throw spriteDocumentError('resource_limit', 'Reference dimensions cannot exceed 1024px.')
    }
    const frameIndex = manifest.frame_order.indexOf(frameId)
    if (frameIndex < 0) throw spriteDocumentError('not_found', 'source frame was not found in document')
    let rgba
    if (sourceKind === 'cel') {
      if (!layerId || !manifest.layer_order.includes(layerId)) {
        throw spriteDocumentError('not_found', 'source layer was not found in document')
      }
      const cel = Object.values(manifest.cels).find(c => c.frame_id === frameId && c.layer_id === layerId)
      if (!cel) throw spriteDocumentError('not_found', 'source cel was not found in document')
      rgba = await readCelBytes(manifest, committed.paths, { frame_id: frameId, layer_id: layerId, cel_id: cel.id })
    } else {
      rgba = await compositePixelFrame(
        manifest,
        frameId,
        (_block, cel) => readCelBytes(manifest, committed.paths, { frame_id: cel.frame_id, layer_id: cel.layer_id, cel_id: cel.id }),
      )
    }
    const rgbaBytes = Buffer.from(rgba)
    const rgbaSha256 = sha256Bytes(rgbaBytes)
    await writeBlockIfAbsent({
      workspaceRoot: loaded.paths.workspaceRoot,
      paths: committed.paths,
      sha256: rgbaSha256,
      bytes: rgbaBytes,
      fault,
    })
    const createdAt = timestamp(now)
    const defaultName = sourceKind === 'cel'
      ? `${manifest.name} · F${frameIndex + 1} · ${manifest.layers[layerId]?.name || layerId}`
      : `${manifest.name} · F${frameIndex + 1}`
    const resolvedName = (name || defaultName).slice(0, SPRITE_DOCUMENT_LIMITS.maxNameLength).trim() || `Reference F${frameIndex + 1}`
    const reference = {
      id: referenceId,
      name: resolvedName,
      purpose,
      status: 'active',
      project_id: projectId,
      canvas_id: canvasId,
      document_id: documentId,
      working_revision: workingRevision,
      frame_id: frameId,
      frame_index: frameIndex,
      layer_id: sourceKind === 'cel' ? layerId : null,
      source_kind: sourceKind,
      width: manifest.canvas.w,
      height: manifest.canvas.h,
      rgba_sha256: rgbaSha256,
      manifest_sha256: committed.manifest_sha256,
      created_at: createdAt,
      operation_id: operationId,
    }
    const next = clonePlain(project)
    next.revision += 1
    next.updated_at = createdAt
    next.references = [...(Array.isArray(next.references) ? next.references : []), reference]
    const receipt = makeReceipt({
      operationId,
      payload,
      project: next,
      documentId,
      documentRevision: workingRevision,
    })
    stageProjectReceipt(next, receipt)
    await publishV1ProjectJson(loaded.paths, next, { fault })
    if (fault === 'ack') {
      throw spriteDocumentError('storage_commit_failed', 'acknowledgement failed after commit', { committed: true })
    }
    return { project: next, receipt, reference, replayed: false }
  })
}

export async function revokeProjectReference({
  projectId,
  referenceId,
  operationId,
  expectedRevision,
  payload,
  projectRoot = process.cwd(),
  workspaceRoot,
  now = new Date(),
  fault = null,
} = {}) {
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    const project = assertV1Project(loaded.project)
    const existingReceipt = await receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot)
    if (existingReceipt) {
      const existingReference = (project.references ?? []).find(item => item?.id === referenceId) ?? null
      await confirmPublishedDurability(loaded.paths)
      return { project, receipt: existingReceipt, reference: existingReference, replayed: true }
    }
    if (project.revision !== expectedRevision) {
      throw spriteDocumentError('stale_revision', 'project revision does not match expected_revision', {
        expected_revision: expectedRevision,
        current_revision: project.revision,
      })
    }
    const refs = Array.isArray(project.references) ? project.references : []
    const index = refs.findIndex(item => item?.id === referenceId)
    if (index < 0) throw spriteDocumentError('not_found', 'project reference was not found')
    if (refs[index].project_id !== projectId) {
      throw spriteDocumentError('unsupported_input', 'Reference does not belong to this project.')
    }
    const createdAt = timestamp(now)
    const next = clonePlain(project)
    next.revision += 1
    next.updated_at = createdAt
    next.references[index] = {
      ...next.references[index],
      status: 'revoked',
      revoked_at: createdAt,
      revoked_operation_id: operationId,
    }
    const receipt = makeReceipt({
      operationId,
      payload,
      project: next,
      documentId: next.references[index].document_id,
      documentRevision: next.references[index].working_revision,
    })
    stageProjectReceipt(next, receipt)
    await publishV1ProjectJson(loaded.paths, next, { fault })
    if (fault === 'ack') {
      throw spriteDocumentError('storage_commit_failed', 'acknowledgement failed after commit', { committed: true })
    }
    return { project: next, receipt, reference: next.references[index], replayed: false }
  })
}

export async function readVerifiedProjectReference({
  projectId,
  project: loadedProject = null,
  referenceId,
  projectRoot = process.cwd(),
  workspaceRoot,
} = {}) {
  if (!isValidId(referenceId)) {
    throw spriteDocumentError('invalid_request', 'reference_id is invalid')
  }
  const project = loadedProject
    ? assertV1Project(loadedProject)
    : assertV1Project((await loadEditorProject({ projectId, projectRoot, workspaceRoot })).project)
  if (project.id !== projectId) {
    throw spriteDocumentError('unsupported_input', 'Reference does not belong to this project.')
  }
  const ref = (project.references ?? []).find(item => item?.id === referenceId)
  if (!ref) {
    throw spriteDocumentError('unsupported_input', `Reference "${referenceId}" was not found in this project.`)
  }
  if (ref.project_id !== projectId) {
    throw spriteDocumentError('unsupported_input', `Reference "${referenceId}" does not belong to this project.`)
  }
  if (ref.status !== 'active') {
    throw spriteDocumentError('unsupported_input', `Reference "${ref.name || referenceId}" has been revoked and cannot be used.`)
  }
  const committed = await loadCommittedManifest(project, ref.document_id, ref.working_revision, projectRoot, workspaceRoot)
  if (committed.manifest_sha256 !== ref.manifest_sha256) {
    throw spriteDocumentError('artifact_integrity_failed', `Reference "${ref.name || referenceId}" provenance manifest hash mismatch.`)
  }
  const blockPath = spriteDocumentBlockPath(committed.paths, ref.rgba_sha256)
  const bytes = await readV1Bytes(blockPath, 'reference block')
  if (bytes.length !== ref.width * ref.height * 4 || sha256Bytes(bytes) !== ref.rgba_sha256) {
    throw spriteDocumentError('artifact_integrity_failed', `Reference "${ref.name || referenceId}" pixel block hash mismatch.`)
  }
  return {
    reference: clonePlain(ref),
    rgba: new Uint8Array(bytes),
    width: ref.width,
    height: ref.height,
    sha256: ref.rgba_sha256,
    provenance: {
      project_id: ref.project_id,
      canvas_id: ref.canvas_id,
      document_id: ref.document_id,
      working_revision: ref.working_revision,
      frame_id: ref.frame_id,
      frame_index: ref.frame_index,
      layer_id: ref.layer_id,
      source_kind: ref.source_kind,
      manifest_sha256: ref.manifest_sha256,
    },
  }
}

export async function readProjectReferencePng({
  projectId,
  referenceId,
  projectRoot = process.cwd(),
  workspaceRoot,
} = {}) {
  const verified = await readVerifiedProjectReference({ projectId, referenceId, projectRoot, workspaceRoot })
  const pngBytes = encodeRgbaPng(verified.width, verified.height, Buffer.from(verified.rgba))
  return {
    reference: verified.reference,
    pngBytes,
    sha256: verified.sha256,
    width: verified.width,
    height: verified.height,
  }
}

export async function acceptDocumentCandidate({ projectId, documentId, canvasId, operationId, expectedRevision, expectedWorkingRevision, expectedEditableFrameIds = null, payload, candidate, projectRoot = process.cwd(), workspaceRoot, now = new Date(), fault = null }) {
  // Reading determines the commit path only; each path rechecks versions under its single mutation lock.
  const { project } = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
  const replay = await receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot)
  if (replay) {
    const committed = await loadCommittedManifest(project, replay.document_id, replay.document_revision, projectRoot, workspaceRoot)
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    await confirmPublishedDurability(loaded.paths, [committed.paths.documentDir, committed.paths.revisionsDir, committed.paths.blocksDir])
    return { project, document: committed.manifest, receipt: replay, canvas: Object.values(project.canvases).find(c => c.document_id === replay.document_id), replayed: true }
  }
  if (!candidate) throw spriteDocumentError('candidate_expired', 'The unsaved candidate has expired.')
  if (expectedEditableFrameIds != null && candidate.editableFrameIds != null
    && JSON.stringify(expectedEditableFrameIds) !== JSON.stringify(candidate.editableFrameIds)) {
    throw spriteDocumentError('stale_revision', 'Editable frame scope changed.')
  }
  const effectiveScope = expectedEditableFrameIds ?? candidate.editableFrameIds ?? null
  const scopedCandidate = effectiveScope ? { ...candidate, editableFrameIds: effectiveScope } : candidate
  const source = await loadCommittedManifest(project, documentId, expectedWorkingRevision, projectRoot, workspaceRoot)
  if (project.canvases?.[canvasId]?.document_id !== documentId) throw spriteDocumentError('stale_revision', 'Source canvas changed.')
  if (!isEditablePixelDocument(source.manifest, project)) return deriveWorkingSpriteDocument({ projectId, operationId, expectedRevision, sourceCanvasId: canvasId, sourceDocumentId: documentId, sourceRevision: expectedWorkingRevision, payload, projectRoot, workspaceRoot, now, fault, documentCandidate: scopedCandidate })
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, () => commitDerivedRevision({ projectId, documentId, operationId, expectedRevision, expectedWorkingRevision, payload, projectRoot, workspaceRoot, now, fault, documentCandidate: scopedCandidate }))
}

export async function createPixelScopeGrant({ projectId, documentId, body, projectRoot = process.cwd(), workspaceRoot }) {
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    const project = assertV1Project(loaded.project)
    const current = await loadCommittedManifest(project, documentId, null, projectRoot, workspaceRoot)
    return issuePixelScopeGrant({ projectId, projectRoot, workspaceRoot }, project, current.manifest, body)
  })
}

export async function changeWorkingStructure({ projectId, documentId, operationId, expectedRevision, expectedWorkingRevision, command, payload, projectRoot = process.cwd(), workspaceRoot, now = new Date(), fault = null }) {
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, () => commitDerivedRevision({
    projectId, documentId, operationId, expectedRevision, expectedWorkingRevision, payload, projectRoot, workspaceRoot, now, fault,
    prepareStructure: async (current, project) => {
      let blockMap = null
      let blocks = null
      if (command?.type === 'resize-canvas') {
        const preflightMap = new Map()
        for (const cel of Object.values(current.manifest.cels || {})) {
          if (cel?.block && !preflightMap.has(cel.block.sha256)) {
            preflightMap.set(cel.block.sha256, { sha256: cel.block.sha256, w: command.width, h: command.height })
          }
        }
        const preflightUpdated = applyStructureCommand(
          current.manifest,
          command,
          label => deriveStableId('s', `${documentId}:${operationId}:${label}`),
          { project, blockMap: preflightMap },
        )
        const preflightManifest = clonePlain(current.manifest)
        for (const key of ['canvas', ...PIXEL_STRUCTURE_FIELDS]) {
          if (Object.hasOwn(preflightUpdated, key)) preflightManifest[key] = clonePlain(preflightUpdated[key])
          else if (key === 'tags') preflightManifest.tags = Array.isArray(preflightManifest.tags) ? preflightManifest.tags : []
          else delete preflightManifest[key]
        }
        assertDocumentLimits(preflightManifest)
        assertJsonByteLimit(preflightManifest, SPRITE_DOCUMENT_LIMITS.maxManifestBytes, 'manifest')
        assertValidSpriteDocument(preflightManifest)
        blockMap = new Map()
        blocks = new Map()
        const oldW = current.manifest.canvas.w
        const oldH = current.manifest.canvas.h
        for (const cel of Object.values(current.manifest.cels || {})) {
          if (!cel?.block || blockMap.has(cel.block.sha256)) continue
          const oldBytes = await readCelBytes(current.manifest, current.paths, { frame_id: cel.frame_id, layer_id: cel.layer_id, cel_id: cel.id })
          const nextBytes = transformCanvasRgba(oldBytes, oldW, oldH, command.width, command.height, command.offset_x, command.offset_y)
          const nextSha = sha256Bytes(nextBytes)
          blockMap.set(cel.block.sha256, { sha256: nextSha, w: command.width, h: command.height })
          blocks.set(nextSha, nextBytes)
        }
      }
      return {
        blocks,
        structure: (manifest, proj) => applyStructureCommand(manifest, command, label => deriveStableId('s', `${documentId}:${operationId}:${label}`), { project: proj, blockMap }),
      }
    },
  }))
}

export async function restoreWorkingSpriteDocument({
  projectId,
  documentId,
  operationId,
  expectedRevision,
  expectedWorkingRevision,
  targetRevision,
  mode,
  payload,
  projectRoot = process.cwd(),
  workspaceRoot,
  now = new Date(),
  fault = null,
} = {}) {
  return withEditorProjectMutationLock({ projectId, workspaceRoot: workspaceRoot ?? path.join(projectRoot, 'workspace') }, async () => {
    const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
    const project = assertV1Project(loaded.project)
    const existingReceipt = await receiptFromProject(project, operationId, payload, projectRoot, workspaceRoot)
    if (existingReceipt) {
      const committed = await loadCommittedManifest(
        project,
        existingReceipt.document_id,
        existingReceipt.document_revision,
        projectRoot,
        workspaceRoot,
      )
      await confirmPublishedDurability(loaded.paths, [
        committed.paths.documentDir,
        committed.paths.revisionsDir,
        committed.paths.blocksDir,
      ])
      return { project, receipt: existingReceipt, document: committed.manifest, replayed: true }
    }
    if (project.revision !== expectedRevision) {
      throw spriteDocumentError('stale_revision', 'project revision does not match expected_revision', {
        expected_revision: expectedRevision,
        current_revision: project.revision,
      })
    }
    const record = project.sprite_documents?.[documentId]
    if (!record) throw spriteDocumentError('not_found', 'sprite document was not found')
    if (!(await lookupProjectRevision(project, documentId, targetRevision, { projectRoot, workspaceRoot }))) {
      throw spriteDocumentError('not_found', 'target revision was not found')
    }
    if (record.working_revision !== expectedWorkingRevision) {
      throw spriteDocumentError('stale_revision', 'working revision does not match expected_working_revision', {
        expected_revision: expectedWorkingRevision,
        current_revision: record.working_revision,
      })
    }
    const current = await loadCommittedManifest(project, documentId, record.working_revision, projectRoot, workspaceRoot)
    if (mode === 'structure') assertPixelStructure(current.manifest, { derived: true, project })
    else assertWritableDerived(current.manifest, undefined, project)
    const target = await loadCommittedManifest(project, documentId, targetRevision, projectRoot, workspaceRoot)
    if (mode !== 'structure' && (Object.hasOwn(current.manifest, 'links') || Object.hasOwn(target.manifest, 'links'))) {
      throw spriteDocumentError('unsupported_input', 'Restore linked-copy state with structure mode.')
    }
    if (mode === 'structure') assertPixelStructure(target.manifest, { derived: true, project })
    else assertWritableDerived(target.manifest, undefined, project)
    // A historical revision is trusted only after all its referenced blocks
    // have been read and verified. Restore never invents pixels or identities.
    if (mode === 'structure') for (const cel of Object.values(target.manifest.cels)) {
      if (cel.block) await readCelBytes(target.manifest, target.paths, { frame_id: cel.frame_id, layer_id: cel.layer_id, cel_id: cel.id })
    }
    const restored = mode === 'structure' ? undefined : await readCelBytes(target.manifest, target.paths)
    return commitDerivedRevision({
      projectId,
      documentId,
      operationId,
      expectedRevision,
      expectedWorkingRevision,
      payload,
      projectRoot,
      workspaceRoot,
      now,
      fault,
      nextPixels: restored,
      ...(mode === 'structure' ? { structure: () => target.manifest } : {}),
    })
  })
}

export async function listSpriteDocuments({
  projectId,
  projectRoot = process.cwd(),
  workspaceRoot,
} = {}) {
  const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
  const project = assertV1Project(loaded.project)
  const documents = []
  for (const documentId of Object.keys(project.sprite_documents)) {
    const { manifest } = await loadCommittedManifest(
      project,
      documentId,
      null,
      projectRoot,
      workspaceRoot,
    )
    documents.push({
      document_id: documentId,
      name: manifest.name,
      working_revision: project.sprite_documents[documentId].working_revision,
      accepted_revision: project.sprite_documents[documentId].accepted_revision,
      canvas: manifest.canvas,
    })
  }
  return { project, documents }
}

export async function getSpriteDocument({
  projectId,
  documentId,
  revision = null,
  projectRoot = process.cwd(),
  workspaceRoot,
} = {}) {
  const loaded = await loadEditorProject({ projectId, projectRoot, workspaceRoot })
  const project = assertV1Project(loaded.project)
  if (project.id !== projectId || !project.sprite_documents?.[documentId]) {
    throw spriteDocumentError('not_found', 'sprite document does not belong to this project')
  }
  return loadCommittedManifest(project, documentId, revision, projectRoot, workspaceRoot)
}

export async function readSpriteBlock({
  projectId,
  documentId,
  sha256,
  projectRoot = process.cwd(),
  workspaceRoot,
} = {}) {
  if (!isSha256Hex(sha256)) {
    throw spriteDocumentError('invalid_request', 'block hash is invalid')
  }
  const loaded = await getSpriteDocument({
    projectId,
    documentId,
    projectRoot,
    workspaceRoot,
  })
  if (!referencedBlockHashes(loaded.manifest).has(sha256)) {
    throw spriteDocumentError('not_found', 'block is not a committed reference of this document')
  }
  const cacheKey = `${projectId}/${documentId}/${sha256}`
  const cached = cacheGet(cacheKey)
  const filePath = spriteDocumentBlockPath(loaded.paths, sha256)
  const bytes = cached ?? await readV1Bytes(filePath, 'block')
  if (sha256Bytes(bytes) !== sha256) {
    throw spriteDocumentError('artifact_integrity_failed', 'block hash does not match its identity')
  }
  const cel = Object.values(loaded.manifest.cels).find((item) => item.block?.sha256 === sha256)
  if (!cel?.block || bytes.length !== cel.block.w * cel.block.h * 4) {
    throw spriteDocumentError('artifact_integrity_failed', 'block length does not match the committed size')
  }
  if (!cached) cacheSet(cacheKey, bytes)
  return {
    bytes,
    sha256,
    width: cel.block.w,
    height: cel.block.h,
  }
}

export function createV1ApiReceipt(receipt, extras = {}) {
  return {
    ...clonePlain(receipt),
    ...extras,
  }
}
