import { lstat } from 'node:fs/promises'
import { EDITOR_PROJECT_V1_VERSION, EDITOR_PROJECT_V2_VERSION, SPRITE_DOCUMENT_LIMITS } from './constants.js'
import { resolveEditorProjectPaths, resolveSpriteDocumentPaths, spriteDocumentRevisionPath } from './paths.js'
import { parseEditorProjectJson } from './serializer.js'
import { clonePlain } from './safety.js'
import { isSha256Hex, spriteDocumentError } from './spriteDocumentValidation.js'
import { createProjectHistoryIndex, documentHistoryKey, readHistoryReceiptRecord, writeHistoryReceipt, writeHistoryBytes, readHistorySourceRoot } from './projectHistoryIndex.js'

const fail = message => { throw spriteDocumentError('artifact_integrity_failed', message) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const currentMetadata = metadata => {
  if (!metadata || !isSha256Hex(metadata.manifest_sha256) || !Number.isFinite(Date.parse(metadata.created_at))
    || (metadata.parent_revision != null && (!Number.isSafeInteger(metadata.parent_revision) || metadata.parent_revision < 1))) {
    fail('history revision metadata is invalid')
  }
  return { manifest_sha256: metadata.manifest_sha256,
    parent_revision: metadata.parent_revision ?? null, created_at: metadata.created_at }
}
const projectPaths = (project, options) => resolveEditorProjectPaths({ projectId: project.id, ...options })

export async function lookupProjectReceipt(project, operationId, options) {
  if (project.version !== EDITOR_PROJECT_V2_VERSION) return project.operation_receipts?.[operationId] ?? null
  const paths = projectPaths(project, options)
  const hash = await createProjectHistoryIndex(paths, 'receipts').get(project.history.receipts, operationId)
  if (!hash) return null
  const receipt = await readHistoryReceiptRecord(paths, hash)
  if (receipt?.operation_id !== operationId || receipt.project_id !== project.id
    || !isSha256Hex(receipt.payload_sha256) || !Number.isSafeInteger(receipt.project_revision)
    || receipt.project_revision < 1 || receipt.project_revision > project.revision) fail('history receipt identity is invalid')
  return receipt
}

export async function lookupProjectRevision(project, documentId, revision, options) {
  const record = project.sprite_documents?.[documentId]
  if (!record) return null
  if (project.version !== EDITOR_PROJECT_V2_VERSION) return record.revisions?.[String(revision)] ?? null
  const paths = projectPaths(project, options)
  const hash = await createProjectHistoryIndex(paths, 'revisions')
    .get(project.history.revisions, documentHistoryKey(documentId, revision))
  if (!hash) {
    if (revision === record.working_revision || revision === record.accepted_revision) fail('current document is missing from history')
    return null
  }
  const result = await readHistoryReceiptRecord(paths, hash)
  if (!isSha256Hex(result.manifest_sha256) || !Number.isFinite(Date.parse(result.created_at))
    || (result.parent_revision != null && (!Number.isSafeInteger(result.parent_revision) || result.parent_revision < 1))) {
    fail('history revision metadata is invalid')
  }
  if ((revision === record.working_revision && !same(currentMetadata(result), record.working))
    || (revision === record.accepted_revision && !same(currentMetadata(result), record.accepted))) fail('document head disagrees with history')
  return result
}

export function stageProjectReceipt(project, receipt) {
  project.operation_receipts ??= {}
  project.operation_receipts[receipt.operation_id] = receipt
}

async function originalRoot(paths) {
  let stat
  try { stat = await lstat(paths.projectJson) } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > SPRITE_DOCUMENT_LIMITS.maxProjectJsonBytes) fail('unsafe source project index')
  const bytes = await readHistorySourceRoot(paths)
  if (bytes.length > SPRITE_DOCUMENT_LIMITS.maxProjectJsonBytes) fail('source project index exceeds byte limit')
  return { bytes, project: parseEditorProjectJson(bytes.toString('utf8')) }
}

// Called inside the existing project mutation lock. Only the returned root is
// committed; immutable files prepared here cannot independently become history.
export async function prepareHistoryProject(paths, next, { fault = null, verifyLegacyRevision, create = false } = {}) {
  const current = await originalRoot(paths)
  if (!current && !create) fail('committed project head is missing')
  if (current && create) throw spriteDocumentError('operation_conflict', 'target project already exists')
  if (!Number.isSafeInteger(next.revision)) throw spriteDocumentError('resource_limit', 'project revision exceeds safe integer range')
  const legacy = current?.project.version === EDITOR_PROJECT_V1_VERSION
  if (current && ![EDITOR_PROJECT_V1_VERSION, EDITOR_PROJECT_V2_VERSION].includes(current.project.version)) {
    throw spriteDocumentError('unsupported_project_writer', 'unsupported source project version')
  }
  if (current && (current.project.id !== next.id || next.revision !== current.project.revision + 1)) {
    throw spriteDocumentError('revision_conflict', 'project changed before history preparation')
  }
  for (const id of Object.keys(current?.project.sprite_documents ?? {})) {
    if (!next.sprite_documents?.[id]) fail('historical document cannot be removed')
  }
  const options = { fault }
  const revisions = createProjectHistoryIndex(paths, 'revisions', options)
  const receipts = createProjectHistoryIndex(paths, 'receipts', options)
  const head = clonePlain(next)
  head.version = EDITOR_PROJECT_V2_VERSION
  let revisionRoot = current?.project.history?.revisions ?? null
  let receiptRoot = current?.project.history?.receipts ?? null
  let legacyBackup = current?.project.history?.legacy_backup ?? null
  if (legacy) {
    const entries = []
    for (const [id, document] of Object.entries(current.project.sprite_documents)) {
      const pending = next.sprite_documents[id]
      if (!pending) fail('migration cannot remove historical document')
      for (const [revision, metadata] of Object.entries(document.revisions)) {
        if (!same(pending.revisions?.[revision], metadata)) fail('migration cannot replace committed revision metadata')
        if (!verifyLegacyRevision) fail('migration requires reference verification')
        await verifyLegacyRevision(current.project, id, Number(revision))
        entries.push([documentHistoryKey(id, Number(revision)), await writeHistoryReceipt(paths, metadata, options)])
      }
    }
    revisionRoot = await revisions.build(entries)
    const receiptEntries = []
    for (const [id, receipt] of Object.entries(current.project.operation_receipts)) {
      if (!same(next.operation_receipts?.[id], receipt)) fail('migration cannot replace committed receipt')
      receiptEntries.push([id, await writeHistoryReceipt(paths, receipt, options)])
    }
    receiptRoot = await receipts.build(receiptEntries)
    legacyBackup = await writeHistoryBytes(paths, 'legacy', current.bytes, options)
  }
  for (const [id, document] of Object.entries(head.sprite_documents)) {
    const old = current?.project.sprite_documents?.[id]
    let maxRevision = old?.max_revision ?? 0
    if (legacy && old) maxRevision = Math.max(...Object.keys(old.revisions).map(Number))
    for (const [revision, metadata] of Object.entries(document.revisions ?? {})) {
      const key = documentHistoryKey(id, Number(revision))
      const existing = await revisions.get(revisionRoot, key)
      if (existing) {
        if (!same(await readHistoryReceiptRecord(paths, existing), metadata)) fail('committed revision cannot be replaced')
      } else {
        // The first durable manifest timestamp remains stable across failed-head
        // retries, so one operation cannot accumulate timestamp-only COW pages.
        const documentPaths = resolveSpriteDocumentPaths({ projectId: head.id, documentId: id,
          workspaceRoot: paths.workspaceRoot })
        const stat = await lstat(spriteDocumentRevisionPath(documentPaths, Number(revision)))
        if (!stat.isFile() || stat.isSymbolicLink()) fail('unsafe prepared manifest')
        metadata.created_at = stat.mtime.toISOString()
        revisionRoot = await revisions.put(revisionRoot, key, await writeHistoryReceipt(paths, metadata, options))
      }
      maxRevision = Math.max(maxRevision, Number(revision))
    }
    const workingHash = await revisions.get(revisionRoot, documentHistoryKey(id, document.working_revision))
    const acceptedHash = document.accepted_revision === null ? null
      : await revisions.get(revisionRoot, documentHistoryKey(id, document.accepted_revision))
    if (!workingHash || (document.accepted_revision !== null && !acceptedHash)) fail('new head refers to an uncommitted revision')
    const working = currentMetadata(await readHistoryReceiptRecord(paths, workingHash))
    const accepted = acceptedHash ? currentMetadata(await readHistoryReceiptRecord(paths, acceptedHash)) : null
    head.sprite_documents[id] = { id, working_revision: document.working_revision,
      accepted_revision: document.accepted_revision, max_revision: maxRevision, working, accepted }
  }
  for (const [id, receipt] of Object.entries(next.operation_receipts ?? {})) {
    const hash = await writeHistoryReceipt(paths, receipt, options)
    receiptRoot = await receipts.put(receiptRoot, id, hash)
  }
  delete head.operation_receipts
  head.history = { version: 'editor_history_v1', revisions: revisionRoot, receipts: receiptRoot, legacy_backup: legacyBackup }
  return head
}
