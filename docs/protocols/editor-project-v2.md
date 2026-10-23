# Editor Project v2: current state and complete history

Status: implementation in progress; acceptance and release are pending. Approved scope:
[history storage plan](../plans/2026-10-12-editor-history-storage-plan.md).
The sprite manifest remains `sprite_document_v1`; this protocol changes project
storage, not pixels, editable text, source immutability, permissions, or autosave timing.

## Root and records

`project.json` has version `editor_project_v2` and retains current v1 project fields
except the complete `operation_receipts` map. Each `sprite_documents[id]` contains
`id`, `working_revision`, `accepted_revision`, `max_revision`, `working`, and `accepted`.
The last two fields contain current manifest hash, parent revision, and creation time;
accepted is null when there is no accepted pointer. Complete historical metadata,
including legal legacy extension fields, remains in immutable records.

`history` contains `version: editor_history_v1`, `revisions`, `receipts`, and
`legacy_backup`. Each reference is a lowercase SHA-256 hash or null.
The root is still limited to 2 MiB and never embeds the full history.

Files beneath the same project directory:

- `history-v2/pages/<sha256>.json`: at most 16 KiB.
- `history-v2/records/<sha256>.json`: complete revision metadata or complete receipt,
  at most 2 MiB each. Receipts retain recovery fields such as `detached_canvas`.
- `history-v2/legacy/<sha256>.json`: exact original v1 project bytes, at most 2 MiB.
- Existing manifest and block paths are unchanged; migration does not copy them.

Objects are UTF-8 JSON plus a newline, with hashes over the exact bytes.
Legacy backup bytes are not reserialized. No committed object is overwritten or deleted.

## Bounded indexes

Two separate immutable balanced search trees index revisions and receipts.
Pages have `version: editor_history_page_v1`, `tree: revisions | receipts`,
`level`, and ordered `entries: [[key, hash], ...]`.

- Level zero points to complete immutable records. Internal entries are the maximum
  key in each child subtree and the child's page hash.
- Revision key: SHA-256 of UTF-8 document ID, colon, positive safe integer revision
  left-padded to 16 decimal digits. Receipt key: the existing operation UUID.
- Binary string order is used, independent of locale. No duplicate key is allowed;
  replay may reuse an identical value but cannot replace a committed value.
- A page has at most 32 entries. Overflow splits into two pages; only its ancestor
  path is rewritten. The maximum depth is eight pages, including the leaf.
- Old roots remain valid. Readers validate child levels, key order/ranges, hashes,
  file bounds and containment. Missing/corrupt referenced objects fail closed.
- Both record kinds are stored out of line: a legal large legacy revision extension
  or recovery receipt cannot overflow an index leaf.
- The process cache owns its byte buffers, has an aggregate 8 MiB limit, and is keyed
  by contained project path and object hash. Warm reads validate file identity;
  replacement or corruption cannot rely only on an old cached path.

The current root alone defines committed reachability. A prepared record, page, or
manifest cannot become history merely because its file exists or revision is lower.
No full-history download endpoint or new history UI is added.
Internal traversal defaults to at most 8,192 pages and 100,000 records. Callers may
set positive safe-integer budgets no greater than 1,000,000; exceeding either bound
fails with `resource_limit`. Normal open/save/replay does not use full traversal.

## Compatibility and the one commit point

Opening/listing/exporting an existing v1 project is read-only and does not upgrade it.
Replaying an existing operation ID returns its original receipt without migration.
V0 remains v0; the existing v0 copy-upgrade still creates an independent v1 copy.

The first new v1 mutation holds the existing project lock, validates every old
manifest/block reference and preserves all old document records and receipts.
It prepares the exact old root backup, indexes and requested mutation, then publishes
one v2 root. Only the requested business mutation increments revisions and history.
A near-limit v1 root is converted before serializing any enlarged inline index.

New pixel projects use v2. The existing typed creation URL `/api/editor/projects/v1`
is retained as an API route name, not a promise of v1 storage; its response declares v2.
The new local-editor client sends `X-Editor-Storage-Version: 2` for typed mutations.
Missing/unknown capabilities are rejected before mutation. The v0 copy-upgrade
remains exempt. Capability is neither an authorization grant nor part of the payload hash.
Origin validation, expected revisions, scope grants, and original operation IDs remain.

New legacy writers allow only actual v0 data, including the lock-time disk check.
Spoofing an incoming v0 version cannot overwrite a v2 root.
Old versions are not supported as concurrent writers; offline downgrade is not promised.

Save ordering: validate committed root and receipt; prepare/fsync immutable dependencies;
serialize and fsync the small new root; atomically replace `project.json`; fsync its parent;
then acknowledge. There is only one mutable commit point.
The caller receives the canonical published v2 root and complete operation receipt.

A missing head during an update is an integrity failure, not permission to create a
new project. Historical documents cannot be removed by this storage change.
Current/accepted pointers must agree with their indexed metadata.
New revision timestamps use the first durable manifest timestamp, stable over retries;
existing revision metadata is preserved exactly.

Before root publication, failure leaves the old root authoritative. After possible
publication, directory-sync or acknowledgement failure is an unknown result;
the original operation ID resolves whether the write committed. No automatic rollback.
Repeated failed-head retries reuse stable preparation bytes; no timestamp-only index
variants are produced. Prepared files are retained for diagnosis, not auto-cleaned.

## Errors and acceptance boundaries

The existing API mappings remain explicit:

| Typed error | HTTP |
| --- | ---: |
| `unsupported_project_writer`, `stale_revision`, `operation_conflict` | 409 |
| `resource_limit` | 413 |
| `artifact_integrity_failed`, `unsupported_input` | 422 |
| `storage_commit_failed` | 500 |
| `not_found` | 404 |
| `invalid_request` / `forbidden_origin` | 400 / 403 |

An immutable dependency's publication-sync failure retains the existing conservative
unknown-outcome classification, although the authoritative root may still be old.
Read the committed root and original operation receipt to resolve it; the dependency's
presence or an error flag alone is not evidence that the project mutation committed.
Storage cannot promise infinite capacity, physical power-loss proof, or network-disk semantics.

Required acceptance is the approved plan: v1/v2/v0 compatibility, complete-history
preservation, injected failures and restart, 5,000 real writes to one project, bounded
cache/root/response cost, actual disk amplification, UI and export regressions, independent
review, and remaining human interaction checks. This document is not a passing test report.
No commit or push is authorized by the plan approval.
