import { createHash } from 'node:crypto'
import { createPixelEditCandidate } from './pixelEditOps.js'
import { encodeRgbaPng } from './spriteDocumentStore.js'

const SIZE = 64
const MAX_ARGUMENT_CHARACTERS = 64 * 1024
const RECT = Object.freeze({ x: 0, y: 0, w: SIZE, h: SIZE })
const TYPES = ['pencil', 'eraser', 'line', 'rectangle', 'flood-fill', 'fill-rect', 'erase', 'replace-color']
const LEGACY_ALLOWED_OPERATIONS = Object.freeze([...TYPES, 'text', 'working_pixels', 'read_canvas', 'draw_pixels', 'undo_pixels', 'pixel_tools'])
const ALL_ALLOWED_OPERATIONS = Object.freeze([...LEGACY_ALLOWED_OPERATIONS, 'read_region', 'patch_region'])
export const CODEBOOK_SYMBOLS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
export const PIXEL_CODEBOOK_VERSION = 'pixel_codebook_v1'
const HEX64 = /^[a-f0-9]{64}$/
const integer = { type: 'integer', minimum: 0, maximum: 63 }
const point = { type: 'object', additionalProperties: false, required: ['x', 'y'],
  description: 'Integer pixel that must lie inside the operation rectangle. Runtime validation remains authoritative.',
  properties: { x: integer, y: integer } }
const rect = { type: 'object', additionalProperties: false, required: ['x', 'y', 'w', 'h'],
  description: 'Must fit completely inside the authorized rectangle and 64x64 canvas: x+w and y+h must not exceed bounds. No clipping.',
  properties: { x: integer, y: integer, w: { type: 'integer', minimum: 1, maximum: 64 }, h: { type: 'integer', minimum: 1, maximum: 64 } } }
const channel = { type: 'integer', minimum: 0, maximum: 255 }
const color = { type: 'array', minItems: 4, maxItems: 4, prefixItems: [channel, channel, channel, { type: 'integer', enum: [0, 255] }], items: false,
  description: 'Straight RGBA8. Alpha is only 0 or 255.' }
const fields = {
  pencil: { points: { type: 'array', minItems: 1, maxItems: 256, items: point }, color },
  eraser: { points: { type: 'array', minItems: 1, maxItems: 256, items: point } },
  line: { start: point, end: point, color }, rectangle: { start: point, end: point, color },
  'flood-fill': { seed: point, color }, 'fill-rect': { color }, erase: {}, 'replace-color': { from: color, to: color },
}
const empty = { type: 'object', properties: {}, additionalProperties: false }
const targetSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['frame_id', 'layer_id', 'cel_id'],
  properties: {
    frame_id: { type: 'string', minLength: 1, maxLength: 128 },
    layer_id: { type: 'string', minLength: 1, maxLength: 128 },
    cel_id: { type: 'string', minLength: 1, maxLength: 128 },
  },
}
export const PIXEL_TOOLS = Object.freeze([
  { type: 'function', name: 'read_canvas', description: 'Read the current 64x64 candidate canvas. It is a preview, not saved.', inputSchema: empty },
  { type: 'function', name: 'read_region', description: 'Read a rectangular region inside the authorized scope as a character grid with the frozen session codebook. Preview only, not saved.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { rect } } },
  { type: 'function', name: 'patch_region', description: 'Apply an atomic character-grid patch to a rectangular region inside the authorized scope. "." keeps the existing pixel (including hidden RGB on transparent pixels); codebook symbols write their exact frozen RGBA8 color. Lowered to bounded pencil operations within a single drawing-batch budget.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['rect', 'grid', 'codebook_hash', 'expected_candidate_hash'], properties: {
      rect,
      grid: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'string', minLength: 1, maxLength: 64 } },
      codebook_hash: { type: 'string', minLength: 64, maxLength: 64 },
      expected_candidate_hash: { type: 'string', minLength: 64, maxLength: 64 },
      target: targetSchema,
    } } },
  { type: 'function', name: 'draw_pixels', description: 'Draw one atomic batch using GameTool native pixel tools. Integer pixels only. Each rectangle must fit completely inside the authorized scope and 64x64 canvas, and every point must lie inside its declared rectangle. Color alpha must be 0 or 255. At most 3 drawing batches. The entire JSON-serialized arguments object must not exceed 65536 characters, even when each array meets its own limit. Invalid arguments are rejected without drawing. The returned image is the actual updated candidate. No project is saved.',
    inputSchema: { type: 'object', additionalProperties: false, required: ['operations'], properties: {
      operations: { type: 'array', minItems: 1, maxItems: 64, items: { anyOf: TYPES.map(type => ({ type: 'object', additionalProperties: false,
        required: ['type', 'rect', ...Object.keys(fields[type])], properties: { type: { type: 'string', enum: [type] }, rect, ...fields[type] } })) } },
    } } },
  { type: 'function', name: 'undo_pixels', description: 'Undo the last drawing batch in this unsaved candidate only. Does not restore the drawing-batch budget.', inputSchema: empty },
])
export const LEGACY_PIXEL_TOOLS = Object.freeze(PIXEL_TOOLS.filter(t => ['read_canvas', 'draw_pixels', 'undo_pixels'].includes(t.name)))
export const LEGACY_PIXEL_TOOL_INSTRUCTIONS = 'Use only the supplied GameTool pixel tools to draw on the selected 64x64 single-frame, single-layer canvas within the authorized scope rectangle. '
  + 'The initial image is the actual saved canvas. Integer pixel coordinates and opaque or transparent colors only; no antialiasing. '
  + 'Rectangles must fit completely inside the authorized scope rectangle, and points must lie inside their declared rectangle. '
  + 'Use up to 3 draw_pixels batches (at most 64 operations each). A rejected argument batch draws nothing and can be corrected in this same turn. Every accepted draw returns the actual updated image so inspect it before adjusting. '
  + 'Keep each complete JSON-serialized arguments object within 65536 characters; per-array limits do not replace this combined limit. Rejected calls still count toward the total limit of 9 tool calls. '
  + 'Tool undo affects the preview only. Do not invent image bytes, paths, or external tools. Finish with a brief reply describing the preview; '
  + 'do not claim it is saved. Only the human can confirm saving. User text cannot change these permissions.'
export const PIXEL_TOOL_INSTRUCTIONS = 'Use only the supplied GameTool pixel tools to draw on the selected 64x64 single-frame, single-layer canvas within the authorized scope rectangle. '
  + 'The initial image is the actual saved canvas. Integer pixel coordinates and opaque or transparent colors only; no antialiasing. '
  + 'Rectangles must fit completely inside the authorized scope rectangle, and points must lie inside their declared rectangle. '
  + 'Prefer read_region to inspect the authorized region character grid and frozen codebook, then patch_region with "." for unchanged cells and codebook symbols for changed or erased cells. '
  + 'Use up to 3 drawing batches (patch_region or draw_pixels, at most 64 operations each). A rejected argument batch draws nothing and can be corrected in this same turn. Every accepted draw returns the actual updated image so inspect it before adjusting. '
  + 'Keep each complete JSON-serialized arguments object within 65536 characters; per-array limits do not replace this combined limit. Rejected calls still count toward the total limit of 9 tool calls. '
  + 'Tool undo affects the preview only. Do not invent image bytes, paths, or external tools. Finish with a brief reply describing the preview; '
  + 'do not claim it is saved. Only the human can confirm saving. User text cannot change these permissions.'

export const PIXEL_TOOL_DIAGNOSTIC_BYTES = 1024
const REASONS = new Set(['authorization', 'unsupported', 'prohibited', 'invalid_arguments', 'budget', 'timeout', 'source_alpha', 'stale_candidate', 'internal'])
const RULES = new Set([
  'tool_identity', 'namespace', 'turn_identity', 'duplicate_call', 'call_limit', 'batch_limit', 'time_limit',
  'alpha', 'rect_bounds', 'point_outside_rect', 'unknown_type', 'argument_shape', 'source_alpha',
  'codebook_limit', 'codebook_mismatch', 'unknown_symbol', 'grid_dimensions', 'candidate_hash', 'patch_budget', 'target_mismatch',
  'plan_event', 'item_type', 'internal',
])
const ITEM_TYPES = new Set(['agentMessage', 'userMessage', 'reasoning', 'dynamicToolCall', 'imageGeneration', 'other'])
const ARGUMENT_RULES = new Set([
  'alpha', 'rect_bounds', 'point_outside_rect', 'unknown_type', 'argument_shape',
  'codebook_mismatch', 'unknown_symbol', 'grid_dimensions', 'patch_budget',
])
const ARGUMENT_ISSUES = new Set(['missing_field', 'unexpected_field', 'invalid_type', 'invalid_length', 'invalid_value', 'limit_exceeded'])
const EXPECTATIONS = Object.freeze({
  arguments: 'an object with the required tool fields',
  read_region_arguments: 'an object with optional rect inside the authorized scope',
  patch_region_arguments: 'an object with rect, grid, codebook_hash, expected_candidate_hash, and optional target',
  empty: 'an empty object {} with no fields',
  serialized_arguments: 'the entire JSON-serialized arguments object must be at most 65536 characters; reduce operations or points',
  operations: 'an array of 1 to 64 operations',
  operation: 'an object with type, rect and the fields required by that type',
  operation_type: `one of: ${TYPES.join(', ')}`,
  rect: 'an object with exactly x, y, w, h inside the authorized rectangle and 64x64 canvas',
  coordinate: 'an integer from 0 to 63',
  dimension: 'an integer from 1 to 64',
  point: 'an object with exactly integer x and y, both inside the operation rectangle',
  points: 'an array of 1 to 256 points, each with exactly integer x and y inside the operation rectangle',
  rgba: 'an array of exactly 4 integer RGBA channels from 0 to 255; alpha must be 0 or 255',
  codebook_color: 'an RGBA8 color present in the frozen session codebook (including [0,0,0,0] for eraser or erase)',
  grid: 'an array of row strings whose length equals rect.h and each row length equals rect.w',
  grid_row: 'a string of codebook symbols or "." whose length equals rect.w',
  grid_symbol: 'either "." (keep pixel) or a symbol present in the frozen session codebook',
  codebook_hash: 'the 64-character hex sha256 of the frozen session codebook',
  expected_candidate_hash: 'the 64-character hex sha256 of the current candidate canvas',
  target: 'an object with frame_id, layer_id, and cel_id matching the authorized target',
  target_id: 'a non-empty string identifier',
  patch_budget: 'a regional diff that lowers to at most 64 pencil operations (256 points each) within 65536 serialized characters',
  ...Object.fromEntries(TYPES.map(type => [`operation_${type}`, `an object with exactly these required fields: type, rect${Object.keys(fields[type]).map(key => `, ${key}`).join('')}`])),
})
const FIELD_EXPECTATIONS = {
  type: 'operation_type', rect: 'rect', color: 'rgba', from: 'rgba', to: 'rgba',
  points: 'points', start: 'point', end: 'point', seed: 'point',
  x: 'coordinate', y: 'coordinate', w: 'dimension', h: 'dimension',
  operations: 'operations', grid: 'grid', codebook_hash: 'codebook_hash',
  expected_candidate_hash: 'expected_candidate_hash', target: 'target',
  frame_id: 'target_id', layer_id: 'target_id', cel_id: 'target_id',
}

// Persist only canonical schema paths and fixed expectation keys, never caller field names or values.
function safeArgumentDetail(last, operationIndex) {
  if (!ARGUMENT_ISSUES.has(last.issue) || typeof last.expected !== 'string' || !Object.hasOwn(EXPECTATIONS, last.expected) || typeof last.field !== 'string') return {}
  const match = /^operations\[(\d{1,2})\](?:\.(?:type|rect(?:\.[xywh])?|(?:start|end|seed)(?:\.[xy])?|points(?:\[(\d{1,3})\](?:\.[xy])?)?|color|from|to))?$/.exec(last.field)
  const rootMatch = /^(?:arguments|operations|rect(?:\.[xywh])?|grid(?:\[(?:[0-9]|[1-5][0-9]|6[0-3])\])?|codebook_hash|expected_candidate_hash|target(?:\.(?:frame_id|layer_id|cel_id))?)$/.test(last.field)
  const valid = operationIndex === null ? rootMatch
    : match && Number(match[1]) === operationIndex && (match[2] === undefined || Number(match[2]) < 256)
  return valid ? { field: last.field, issue: last.issue, expected: last.expected } : {}
}

export function pixelToolDiagnostic(input = {}) {
  const bounded = (value, max) => Number.isInteger(value) && value >= 0 && value <= max ? value : 0
  const diagnostic = {
    reason: REASONS.has(input.reason) ? input.reason : 'internal',
    rule: RULES.has(input.rule) ? input.rule : 'internal',
    operation_index: Number.isInteger(input.operation_index) && input.operation_index >= 0 && input.operation_index < 64 ? input.operation_index : null,
    elapsed_ms: bounded(input.elapsed_ms, 180000),
    terminal: input.terminal !== false,
    calls: bounded(input.calls, 10),
    drawing_batches: bounded(input.drawing_batches, 3),
    argument_corrections: bounded(input.argument_corrections, 9),
    item_type: ITEM_TYPES.has(input.item_type) ? input.item_type : 'other',
  }
  const last = input.last_argument_rejection
const DIAGNOSTIC_TOOL_NAMES = new Set([
  ...PIXEL_TOOLS.map(tool => tool.name),
  'read_document', 'render_review', 'analyze_pixels', 'propose_patch', 'preview_patch',
])
  if (last && DIAGNOSTIC_TOOL_NAMES.has(last.tool) && ARGUMENT_RULES.has(last.rule)) {
    diagnostic.last_argument_rejection = {
      tool: last.tool, rule: last.rule,
      operation_index: Number.isInteger(last.operation_index) && last.operation_index >= 0 && last.operation_index < 64 ? last.operation_index : null,
    }
    Object.assign(diagnostic.last_argument_rejection, safeArgumentDetail(last, diagnostic.last_argument_rejection.operation_index))
  }
  if (Buffer.byteLength(JSON.stringify(diagnostic)) > PIXEL_TOOL_DIAGNOSTIC_BYTES) {
    return { reason: 'internal', rule: 'internal', operation_index: null, elapsed_ms: 0, terminal: true, calls: 0, drawing_batches: 0, argument_corrections: 0, item_type: 'other' }
  }
  return diagnostic
}

export function pixelArgumentCorrection(diagnostic) {
  const safe = pixelToolDiagnostic({ ...diagnostic, terminal: false, reason: 'invalid_arguments' })
  const last = safe.last_argument_rejection
  const detail = last?.field ? ` field=${last.field} issue=${last.issue}. Expected: ${EXPECTATIONS[last.expected]}.` : ''
  return `Drawing arguments were rejected. Nothing was drawn.${detail} Correct and resubmit the entire rejected arguments object to the same tool within the remaining budget; do not resend only its failing operation. rule=${safe.rule} operation_index=${safe.operation_index === null ? 'none' : safe.operation_index} calls=${safe.calls} drawing_batches=${safe.drawing_batches} remaining_tool_calls=${Math.max(0, 9 - safe.calls)}`
}

function fail(code = 'assistant_tool_blocked', diagnostic) {
  throw Object.assign(new Error(code), { code, diagnostic: diagnostic ? pixelToolDiagnostic(diagnostic) : undefined })
}
const digest = rgba => createHash('sha256').update(rgba).digest('hex')
const colorKey = (r, g, b, a) => `${r},${g},${b},${a}`

function validRectObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return null
  if (Reflect.ownKeys(value).length !== 4 || ['x', 'y', 'w', 'h'].some(k => !Object.hasOwn(value, k))) return null
  const { x, y, w, h } = value
  if (![x, y, w, h].every(Number.isInteger) || w < 1 || h < 1 || x < 0 || y < 0 || x + w > SIZE || y + h > SIZE) return null
  return Object.freeze({ x, y, w, h })
}

function rectFits(inner, outer) {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w
    && inner.y + inner.h <= outer.y + outer.h
}

function assertOutsideRectUnchanged(before, after, allowed) {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (x >= allowed.x && x < allowed.x + allowed.w && y >= allowed.y && y < allowed.y + allowed.h) continue
      const offset = (y * SIZE + x) * 4
      if (before[offset] !== after[offset] || before[offset + 1] !== after[offset + 1]
        || before[offset + 2] !== after[offset + 2] || before[offset + 3] !== after[offset + 3]) {
        return false
      }
    }
  }
  return true
}

export function buildPixelCodebook(rgba, allowedRect = RECT, allowedColors = []) {
  const scope = validRectObject(allowedRect)
  if (!scope) fail('assistant_context_changed', { reason: 'authorization', rule: 'rect_bounds', terminal: true, item_type: 'other' })
  if (!Array.isArray(allowedColors)) fail('assistant_context_changed', { reason: 'invalid_arguments', rule: 'argument_shape', terminal: true, item_type: 'other' })
  const seen = new Map()
  for (let y = scope.y; y < scope.y + scope.h; y++) {
    for (let x = scope.x; x < scope.x + scope.w; x++) {
      const offset = (y * SIZE + x) * 4
      const tuple = Object.freeze([rgba[offset], rgba[offset + 1], rgba[offset + 2], rgba[offset + 3]])
      const key = colorKey(tuple[0], tuple[1], tuple[2], tuple[3])
      if (!seen.has(key)) seen.set(key, tuple)
    }
  }
  for (const extra of allowedColors) {
    if (!Array.isArray(extra) || extra.length !== 4 || extra.some(c => !Number.isInteger(c) || c < 0 || c > 255)) {
      fail('assistant_context_changed', { reason: 'invalid_arguments', rule: 'argument_shape', terminal: true, item_type: 'other' })
    }
    if (![0, 255].includes(extra[3])) {
      fail('assistant_context_changed', { reason: 'source_alpha', rule: 'alpha', terminal: true, item_type: 'other' })
    }
    const tuple = Object.freeze([extra[0], extra[1], extra[2], extra[3]])
    const key = colorKey(tuple[0], tuple[1], tuple[2], tuple[3])
    if (!seen.has(key)) seen.set(key, tuple)
  }
  if (seen.size > CODEBOOK_SYMBOLS.length) {
    fail('assistant_context_changed', { reason: 'unsupported', rule: 'codebook_limit', terminal: true, item_type: 'other' })
  }
  const entries = []
  const colorToSymbol = new Map()
  let index = 0
  for (const [key, tuple] of seen.entries()) {
    const symbol = CODEBOOK_SYMBOLS[index++]
    entries.push([symbol, tuple])
    colorToSymbol.set(key, symbol)
  }
  const codebook = Object.freeze(Object.fromEntries(entries))
  const codebookHash = createHash('sha256').update(JSON.stringify({ version: PIXEL_CODEBOOK_VERSION, entries })).digest('hex')
  return { codebook, codebookHash, colorToSymbol, version: PIXEL_CODEBOOK_VERSION }
}

/** One bounded in-memory preview; no file writes or document revisions. */
export function createPixelToolSession({
  rgba,
  allowedRect,
  allowedColors = [],
  allowedOperations,
  target = null,
  grantId = null,
  checkCurrent = async () => {},
  signal,
  now = Date.now,
} = {}) {
  const started = now()
  let batches = 0, calls = 0, corrections = 0, lastRejection = null
  const counts = () => ({ calls, drawing_batches: batches, argument_corrections: corrections, elapsed_ms: Math.max(0, now() - started),
    ...(lastRejection ? { last_argument_rejection: { ...lastRejection } } : {}) })
  if (!(rgba instanceof Uint8Array) || rgba.length !== SIZE * SIZE * 4) fail('assistant_context_changed', { reason: 'authorization', rule: 'turn_identity', terminal: true, item_type: 'other' })
  for (let i = 3; i < rgba.length; i += 4) if (![0, 255].includes(rgba[i])) {
    fail('assistant_context_changed', { reason: 'source_alpha', rule: 'source_alpha', terminal: true, item_type: 'other' })
  }
  const hasGrant = typeof grantId === 'string' && grantId.length > 0
  if (!hasGrant && (allowedRect !== undefined || (Array.isArray(allowedColors) && allowedColors.length > 0))) {
    fail('assistant_context_changed', { reason: 'authorization', rule: 'tool_identity', terminal: true, item_type: 'other' })
  }
  const scopeRect = allowedRect === undefined ? RECT : validRectObject(allowedRect)
  if (!scopeRect) fail('assistant_context_changed', { reason: 'authorization', rule: 'rect_bounds', terminal: true, item_type: 'other' })
  const allowedPool = hasGrant ? ALL_ALLOWED_OPERATIONS : LEGACY_ALLOWED_OPERATIONS
  let allowedOps = allowedPool
  if (allowedOperations !== undefined) {
    if (!Array.isArray(allowedOperations) || !allowedOperations.length || allowedOperations.some(op => typeof op !== 'string' || !allowedPool.includes(op))) {
      fail('assistant_context_changed', { reason: 'authorization', rule: 'tool_identity', terminal: true, item_type: 'other' })
    }
    allowedOps = Object.freeze([...new Set(allowedOperations)].sort())
  }
  const frozenTarget = target && typeof target === 'object' && typeof target.frame_id === 'string' && typeof target.layer_id === 'string' && typeof target.cel_id === 'string'
    ? Object.freeze({ frame_id: target.frame_id, layer_id: target.layer_id, cel_id: target.cel_id })
    : null
  const codebookMode = hasGrant && (allowedOps.includes('read_region') || allowedOps.includes('patch_region') || allowedOps.includes('pixel_tools'))
  const { codebook, codebookHash, colorToSymbol } = codebookMode
    ? buildPixelCodebook(rgba, scopeRect, allowedColors)
    : { codebook: null, codebookHash: null, colorToSymbol: null }
  let pixels = new Uint8Array(rgba)
  const history = [], trace = []
  const sourceSha256 = digest(pixels)
  const imageUrl = () => `data:image/png;base64,${encodeRgbaPng(SIZE, SIZE, Buffer.from(pixels)).toString('base64')}`
  function rejectArguments(rule, operationIndex = null, tool = 'draw_pixels', detail = {}) {
    corrections++
    lastRejection = { tool, rule, operation_index: operationIndex, ...safeArgumentDetail(detail, operationIndex) }
    const error = Object.assign(new Error('pixel_tool_invalid_arguments'), { code: 'pixel_tool_invalid_arguments', recoverable: true })
    error.diagnostic = pixelToolDiagnostic({ reason: 'invalid_arguments', rule, operation_index: operationIndex, terminal: false, ...counts() })
    throw error
  }
  function rejectBudget(rule) {
    fail('assistant_tool_blocked', { reason: 'budget', rule, terminal: true, ...counts() })
  }
  function integerIn(value) { return Number.isInteger(value) }
  function readOwned(value, key) {
    const descriptor = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, key) : null
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined
  }
  function rejectField(field, issue, expected, index = null, rule = 'argument_shape', tool = 'draw_pixels') {
    rejectArguments(rule, index, tool, { field, issue, expected })
  }
  function requireFields(value, required, field, expected, index, tool = 'draw_pixels', optional = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      rejectField(field, 'invalid_type', expected, index, 'argument_shape', tool)
    }
    const prefix = field === 'arguments' ? '' : `${field}.`
    for (const key of required) {
      const path = `${prefix}${key}`
      if (!Object.hasOwn(value, key)) rejectField(path, 'missing_field', FIELD_EXPECTATIONS[key], index, 'argument_shape', tool)
      if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) rejectField(path, 'invalid_type', FIELD_EXPECTATIONS[key], index, 'argument_shape', tool)
    }
    for (const key of optional) {
      const path = `${prefix}${key}`
      if (Object.hasOwn(value, key) && !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) {
        rejectField(path, 'invalid_type', FIELD_EXPECTATIONS[key], index, 'argument_shape', tool)
      }
    }
    const allowedKeys = [...required, ...optional]
    if (Reflect.ownKeys(value).some(key => !allowedKeys.includes(key))) rejectField(field, 'unexpected_field', expected, index, 'argument_shape', tool)
  }
  function requireColor(value, index, field, tool = 'draw_pixels') {
    if (!Array.isArray(value)) rejectField(field, 'invalid_type', 'rgba', index, 'argument_shape', tool)
    if (value.length !== 4) rejectField(field, 'invalid_length', 'rgba', index, 'argument_shape', tool)
    if ([0, 1, 2, 3].some(channel => !integerIn(readOwned(value, channel)) || value[channel] < 0 || value[channel] > 255)) rejectField(field, 'invalid_value', 'rgba', index, 'argument_shape', tool)
    if (![0, 255].includes(value[3])) rejectField(field, 'invalid_value', 'rgba', index, 'alpha', tool)
  }
  function requireRect(value, index, field = `operations[${index}].rect`, tool = 'draw_pixels') {
    requireFields(value, ['x', 'y', 'w', 'h'], field, 'rect', index, tool)
    const x = readOwned(value, 'x'), y = readOwned(value, 'y'), w = readOwned(value, 'w'), h = readOwned(value, 'h')
    for (const [key, v] of Object.entries({ x, y, w, h })) if (!integerIn(v)) rejectField(`${field}.${key}`, 'invalid_type', FIELD_EXPECTATIONS[key], index, 'argument_shape', tool)
    if (w < 1 || h < 1) rejectField(`${field}.${w < 1 ? 'w' : 'h'}`, 'invalid_value', 'dimension', index, 'argument_shape', tool)
    const parsed = { x, y, w, h }
    if (x < 0 || y < 0 || x + w > SIZE || y + h > SIZE || !rectFits(parsed, scopeRect)) {
      rejectField(field, 'invalid_value', 'rect', index, 'rect_bounds', tool)
    }
    return parsed
  }
  function requirePoint(value, rect, index, field) {
    requireFields(value, ['x', 'y'], field, 'point', index)
    const x = readOwned(value, 'x'), y = readOwned(value, 'y')
    for (const [key, v] of Object.entries({ x, y })) if (!integerIn(v)) rejectField(`${field}.${key}`, 'invalid_type', 'coordinate', index)
    if (x < rect.x || y < rect.y || x >= rect.x + rect.w || y >= rect.y + rect.h) rejectField(field, 'invalid_value', 'point', index, 'point_outside_rect')
  }
  function encodeRegionGrid(regionRect) {
    const grid = []
    for (let y = regionRect.y; y < regionRect.y + regionRect.h; y++) {
      let row = ''
      for (let x = regionRect.x; x < regionRect.x + regionRect.w; x++) {
        const offset = (y * SIZE + x) * 4
        const symbol = colorToSymbol.get(colorKey(pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]))
        if (!symbol) fail('assistant_tool_blocked', { reason: 'unsupported', rule: 'codebook_mismatch', terminal: true, ...counts() })
        row += symbol
      }
      grid.push(row)
    }
    return grid
  }
  function toolAllowed(name) {
    if ((name === 'read_region' || name === 'patch_region') && !codebookMode) return false
    if (allowedOps.includes(name) || allowedOps.includes('pixel_tools')) return true
    if (name === 'read_canvas' && (allowedOps.includes('read_region') || allowedOps.includes('working_pixels'))) return true
    if (name === 'undo_pixels' && (allowedOps.includes('patch_region') || allowedOps.includes('draw_pixels') || allowedOps.includes('working_pixels') || TYPES.some(t => allowedOps.includes(t)))) return true
    if (name === 'draw_pixels' && (allowedOps.includes('working_pixels') || TYPES.some(t => allowedOps.includes(t)))) return true
    return false
  }
  const activeTools = codebookMode ? Object.freeze(PIXEL_TOOLS.filter(t => toolAllowed(t.name))) : LEGACY_PIXEL_TOOLS
  const activeInstructions = activeTools.some(t => t.name === 'read_region' || t.name === 'patch_region')
    ? PIXEL_TOOL_INSTRUCTIONS
    : LEGACY_PIXEL_TOOL_INSTRUCTIONS
  return {
    initialImage: imageUrl(),
    allowedRect: scopeRect,
    allowedOperations: allowedOps,
    tools: activeTools,
    instructions: activeInstructions,
    codebookMode,
    codebook,
    codebookHash,
    target: frozenTarget,
    grantId: hasGrant ? grantId : null,
    status: () => counts(),
    snapshotState: () => ({
      width: SIZE,
      height: SIZE,
      pixels: new Uint8Array(pixels),
      sourceRgba: new Uint8Array(rgba),
      sourceSha256,
      candidateSha256: digest(pixels),
      allowedRect: scopeRect,
      allowedOperations: allowedOps,
      codebookMode,
      codebook,
      codebookHash,
      colorToSymbol,
      target: frozenTarget,
      grantId: hasGrant ? grantId : null,
      drawingBatches: batches,
      toolCalls: calls,
      imageUrl: imageUrl(),
    }),
    async chargeExternalCall(name, args, run) {
      if (signal?.aborted) fail('assistant_cancelled')
      if (++calls > 9) rejectBudget('call_limit')
      await checkCurrent()
      if (signal?.aborted) fail('assistant_cancelled')
      if (!args || typeof args !== 'object' || Array.isArray(args) || ![Object.prototype, null].includes(Object.getPrototypeOf(args))) {
        rejectField('arguments', 'invalid_type', 'arguments', null, 'argument_shape', name)
      }
      if (JSON.stringify(args).length > MAX_ARGUMENT_CHARACTERS) {
        rejectField('arguments', 'limit_exceeded', 'serialized_arguments', null, 'argument_shape', name)
      }
      return run({
        width: SIZE,
        height: SIZE,
        pixels,
        sourceRgba: rgba,
        sourceSha256,
        currentSha256: digest(pixels),
        scopeRect,
        allowedOps,
        codebookMode,
        codebook,
        codebookHash,
        colorToSymbol,
        frozenTarget,
        grantId: hasGrant ? grantId : null,
        batches,
        calls,
        counts,
        imageUrl,
        requireRect,
        requireFields,
        readOwned,
        rejectField,
        fail,
        trace,
        assertOutsideRectUnchanged,
        digest,
        colorKey,
      })
    },
    async call(name, args) {
      if (signal?.aborted) fail('assistant_cancelled')
      if (!PIXEL_TOOLS.some(t => t.name === name) || !toolAllowed(name)) {
        fail('assistant_tool_blocked', { reason: 'authorization', rule: 'tool_identity', terminal: true, ...counts() })
      }
      if (++calls > 9) rejectBudget('call_limit')
      await checkCurrent()
      if (signal?.aborted) fail('assistant_cancelled')
      if ((name === 'draw_pixels' || name === 'patch_region') && batches >= 3) rejectBudget('batch_limit')
      const argumentShape = name === 'draw_pixels' ? 'arguments'
        : name === 'read_region' ? 'read_region_arguments'
        : name === 'patch_region' ? 'patch_region_arguments'
        : 'empty'
      if (!args || typeof args !== 'object' || Array.isArray(args) || ![Object.prototype, null].includes(Object.getPrototypeOf(args))) {
        rejectField('arguments', 'invalid_type', argumentShape, null, 'argument_shape', name)
      }
      if (JSON.stringify(args).length > MAX_ARGUMENT_CHARACTERS) rejectField('arguments', 'limit_exceeded', 'serialized_arguments', null, 'argument_shape', name)
      if (name === 'read_region') {
        requireFields(args, [], 'arguments', 'read_region_arguments', null, 'read_region', ['rect'])
        const regionRect = Object.hasOwn(args, 'rect') ? requireRect(readOwned(args, 'rect'), null, 'rect', 'read_region') : scopeRect
        const grid = encodeRegionGrid(regionRect)
        const currentSha256 = digest(pixels)
        trace.push({ tool: name, drawing_batches: batches, sha256: currentSha256, rect: regionRect })
        return {
          success: true,
          contentItems: [
            {
              type: 'inputText',
              text: JSON.stringify({
                width: regionRect.w,
                height: regionRect.h,
                canvas_width: SIZE,
                canvas_height: SIZE,
                rect: regionRect,
                allowed_rect: scopeRect,
                allowed_operations: allowedOps,
                grid,
                codebook,
                codebook_version: PIXEL_CODEBOOK_VERSION,
                codebook_hash: codebookHash,
                codebookHash,
                source_sha256: sourceSha256,
                sourceHash: sourceSha256,
                candidate_sha256: currentSha256,
                candidateHash: currentSha256,
                sha256: currentSha256,
                ...(frozenTarget ? { target: frozenTarget } : {}),
                ...(grantId ? { grant_id: grantId } : {}),
                saved: false,
                drawing_batches: batches,
                remaining_drawing_batches: 3 - batches,
                tool_calls: calls,
                remaining_tool_calls: 9 - calls,
              }),
            },
            { type: 'inputImage', imageUrl: imageUrl() },
          ],
        }
      }
      if (name === 'patch_region') {
        requireFields(args, ['rect', 'grid', 'codebook_hash', 'expected_candidate_hash'], 'arguments', 'patch_region_arguments', null, 'patch_region', ['target'])
        const regionRect = requireRect(readOwned(args, 'rect'), null, 'rect', 'patch_region')
        const rawCodebookHash = readOwned(args, 'codebook_hash')
        if (typeof rawCodebookHash !== 'string' || !HEX64.test(rawCodebookHash)) {
          rejectField('codebook_hash', 'invalid_value', 'codebook_hash', null, 'argument_shape', 'patch_region')
        }
        if (rawCodebookHash !== codebookHash) {
          rejectField('codebook_hash', 'invalid_value', 'codebook_hash', null, 'codebook_mismatch', 'patch_region')
        }
        const rawCandidateHash = readOwned(args, 'expected_candidate_hash')
        if (typeof rawCandidateHash !== 'string' || !HEX64.test(rawCandidateHash)) {
          rejectField('expected_candidate_hash', 'invalid_value', 'expected_candidate_hash', null, 'argument_shape', 'patch_region')
        }
        if (Object.hasOwn(args, 'target')) {
          const reqTarget = readOwned(args, 'target')
          requireFields(reqTarget, ['frame_id', 'layer_id', 'cel_id'], 'target', 'target', null, 'patch_region')
          for (const key of ['frame_id', 'layer_id', 'cel_id']) {
            const val = readOwned(reqTarget, key)
            if (typeof val !== 'string' || !val) rejectField(`target.${key}`, 'invalid_value', 'target_id', null, 'argument_shape', 'patch_region')
          }
          if (!frozenTarget || reqTarget.frame_id !== frozenTarget.frame_id || reqTarget.layer_id !== frozenTarget.layer_id || reqTarget.cel_id !== frozenTarget.cel_id) {
            fail('assistant_context_changed', { reason: 'authorization', rule: 'target_mismatch', terminal: true, ...counts() })
          }
        }
        const rawGrid = readOwned(args, 'grid')
        if (!Array.isArray(rawGrid)) rejectField('grid', 'invalid_type', 'grid', null, 'argument_shape', 'patch_region')
        if (rawGrid.length !== regionRect.h) rejectField('grid', 'invalid_length', 'grid', null, 'grid_dimensions', 'patch_region')
        const colorGroups = new Map()
        let changedPixels = 0
        for (let r = 0; r < regionRect.h; r++) {
          const rowField = `grid[${r}]`
          if (!Object.hasOwn(rawGrid, r) || !Object.hasOwn(Object.getOwnPropertyDescriptor(rawGrid, r), 'value')) {
            rejectField(rowField, 'invalid_type', 'grid_row', null, 'argument_shape', 'patch_region')
          }
          const row = readOwned(rawGrid, r)
          if (typeof row !== 'string') rejectField(rowField, 'invalid_type', 'grid_row', null, 'argument_shape', 'patch_region')
          if (row.length !== regionRect.w) rejectField(rowField, 'invalid_length', 'grid_row', null, 'grid_dimensions', 'patch_region')
          for (let c = 0; c < regionRect.w; c++) {
            const ch = row[c]
            if (ch === '.') continue
            if (!Object.hasOwn(codebook, ch)) {
              rejectField(rowField, 'invalid_value', 'grid_symbol', null, 'unknown_symbol', 'patch_region')
            }
          }
        }
        const currentSha256 = digest(pixels)
        if (rawCandidateHash !== currentSha256) {
          fail('assistant_context_changed', { reason: 'stale_candidate', rule: 'candidate_hash', terminal: true, ...counts() })
        }
        for (let r = 0; r < regionRect.h; r++) {
          const row = rawGrid[r]
          const y = regionRect.y + r
          for (let c = 0; c < regionRect.w; c++) {
            const ch = row[c]
            if (ch === '.') continue
            const targetColor = codebook[ch]
            const x = regionRect.x + c
            const offset = (y * SIZE + x) * 4
            if (pixels[offset] === targetColor[0] && pixels[offset + 1] === targetColor[1]
              && pixels[offset + 2] === targetColor[2] && pixels[offset + 3] === targetColor[3]) {
              continue
            }
            const key = colorKey(targetColor[0], targetColor[1], targetColor[2], targetColor[3])
            if (!colorGroups.has(key)) colorGroups.set(key, { color: [...targetColor], points: [] })
            colorGroups.get(key).points.push({ x, y })
            changedPixels++
          }
        }
        const operations = []
        for (const group of colorGroups.values()) {
          for (let i = 0; i < group.points.length; i += 256) {
            operations.push({
              type: 'pencil',
              rect: { ...regionRect },
              color: [...group.color],
              points: group.points.slice(i, i + 256),
            })
          }
        }
        const loweredSerialized = JSON.stringify({ operations })
        if (operations.length > 64 || loweredSerialized.length > MAX_ARGUMENT_CHARACTERS) {
          rejectField('grid', 'limit_exceeded', 'patch_budget', null, 'patch_budget', 'patch_region')
        }
        if (operations.length > 0) {
          let next = pixels
          for (const [index, operation] of operations.entries()) {
            try { next = createPixelEditCandidate({ width: SIZE, height: SIZE, rgba: next }, operation, scopeRect).rgba }
            catch (error) {
              if (error?.code === 'invalid_request') rejectField('grid', 'invalid_value', 'grid', index, 'argument_shape', 'patch_region')
              fail('assistant_tool_blocked', { reason: 'internal', rule: 'internal', terminal: true, ...counts() })
            }
          }
          if (!assertOutsideRectUnchanged(pixels, next, regionRect) || !assertOutsideRectUnchanged(pixels, next, scopeRect)) {
            fail('assistant_tool_blocked', { reason: 'authorization', rule: 'rect_bounds', terminal: true, ...counts() })
          }
          history.push(pixels); pixels = next; batches++
        }
        const updatedSha256 = digest(pixels)
        trace.push({
          tool: name,
          drawing_batches: batches,
          sha256: updatedSha256,
          rect: regionRect,
          noop: operations.length === 0,
          changed_pixels: changedPixels,
          operation_count: operations.length,
        })
        return {
          success: true,
          contentItems: [
            {
              type: 'inputText',
              text: JSON.stringify({
                width: SIZE,
                height: SIZE,
                rect: regionRect,
                allowed_rect: scopeRect,
                saved: false,
                noop: operations.length === 0,
                changed_pixels: changedPixels,
                operation_count: operations.length,
                lowered_byte_length: loweredSerialized.length,
                patch_byte_length: JSON.stringify(args).length,
                drawing_batches: batches,
                remaining_drawing_batches: 3 - batches,
                tool_calls: calls,
                remaining_tool_calls: 9 - calls,
                codebook_hash: codebookHash,
                codebookHash,
                source_sha256: sourceSha256,
                sourceHash: sourceSha256,
                candidate_sha256: updatedSha256,
                candidateHash: updatedSha256,
                sha256: updatedSha256,
              }),
            },
            { type: 'inputImage', imageUrl: imageUrl() },
          ],
        }
      }
      if (name === 'draw_pixels') {
        if (!Object.hasOwn(args, 'operations')) rejectField('operations', 'missing_field', 'operations')
        if (Object.keys(args).length !== 1) rejectField('arguments', 'unexpected_field', 'arguments')
        if (!Array.isArray(args.operations)) rejectField('operations', 'invalid_type', 'operations')
        if (!args.operations.length || args.operations.length > 64) rejectField('operations', 'invalid_length', 'operations')
        const prepared = []
        args.operations.forEach((operation, index) => {
          const field = `operations[${index}]`
          if (!operation || typeof operation !== 'object' || Array.isArray(operation)) rejectField(field, 'invalid_type', 'operation', index)
          if (!Object.hasOwn(operation, 'type')) rejectField(`${field}.type`, 'missing_field', 'operation_type', index)
          const type = readOwned(operation, 'type')
          if (!TYPES.includes(type)) rejectField(`${field}.type`, 'invalid_value', 'operation_type', index, 'unknown_type')
          if (!allowedOps.includes(type) && !allowedOps.includes('draw_pixels') && !allowedOps.includes('pixel_tools')) {
            fail('assistant_tool_blocked', { reason: 'authorization', rule: 'tool_identity', operation_index: index, terminal: true, ...counts() })
          }
          requireFields(operation, ['type', 'rect', ...Object.keys(fields[type])], field, `operation_${type}`, index)
          const opRect = requireRect(readOwned(operation, 'rect'), index)
          if (['pencil', 'eraser'].includes(type)) {
            const points = readOwned(operation, 'points')
            if (!Array.isArray(points)) rejectField(`${field}.points`, 'invalid_type', 'points', index)
            if (!points.length || points.length > 256) rejectField(`${field}.points`, 'invalid_length', 'points', index)
            points.forEach((point, pointIndex) => requirePoint(point, opRect, index, `${field}.points[${pointIndex}]`))
          }
          if (type === 'line' || type === 'rectangle') { requirePoint(readOwned(operation, 'start'), opRect, index, `${field}.start`); requirePoint(readOwned(operation, 'end'), opRect, index, `${field}.end`) }
          if (type === 'flood-fill') requirePoint(readOwned(operation, 'seed'), opRect, index, `${field}.seed`)
          for (const key of ['color', 'from', 'to']) if (Object.hasOwn(operation, key)) requireColor(readOwned(operation, key), index, `${field}.${key}`)
          if (codebookMode) {
            for (const key of ['color', 'to']) {
              if (Object.hasOwn(operation, key)) {
                const c = readOwned(operation, key)
                if (!colorToSymbol.has(colorKey(c[0], c[1], c[2], c[3]))) {
                  rejectField(`${field}.${key}`, 'invalid_value', 'codebook_color', index, 'codebook_mismatch', 'draw_pixels')
                }
              }
            }
            if ((type === 'eraser' || type === 'erase') && !colorToSymbol.has('0,0,0,0')) {
              rejectField(field, 'invalid_value', 'codebook_color', index, 'codebook_mismatch', 'draw_pixels')
            }
          }
          prepared.push(operation)
        })
        let next = pixels
        for (const [index, operation] of prepared.entries()) {
          try { next = createPixelEditCandidate({ width: SIZE, height: SIZE, rgba: next }, operation, scopeRect).rgba }
          catch (error) {
            if (error?.code === 'invalid_request') rejectField(`operations[${index}]`, 'invalid_value', `operation_${readOwned(operation, 'type')}`, index)
            fail('assistant_tool_blocked', { reason: 'internal', rule: 'internal', terminal: true, ...counts() })
          }
        }
        if (!assertOutsideRectUnchanged(pixels, next, scopeRect)) {
          fail('assistant_tool_blocked', { reason: 'authorization', rule: 'rect_bounds', terminal: true, ...counts() })
        }
        if (codebookMode) {
          for (let y = scopeRect.y; y < scopeRect.y + scopeRect.h; y++) {
            for (let x = scopeRect.x; x < scopeRect.x + scopeRect.w; x++) {
              const offset = (y * SIZE + x) * 4
              if (!colorToSymbol.has(colorKey(next[offset], next[offset + 1], next[offset + 2], next[offset + 3]))) {
                rejectField('operations[0]', 'invalid_value', 'codebook_color', 0, 'codebook_mismatch', 'draw_pixels')
              }
            }
          }
        }
        history.push(pixels); pixels = next; batches++
      } else {
        if (Object.keys(args).length) rejectField('arguments', 'unexpected_field', 'empty', null, 'argument_shape', name)
        if (name === 'undo_pixels') {
          if (!history.length) fail('assistant_tool_blocked', { reason: 'unsupported', rule: 'item_type', terminal: true, item_type: 'other', ...counts() })
          pixels = history.pop()
        }
      }
      const currentSha256 = digest(pixels)
      trace.push({ tool: name, drawing_batches: batches, sha256: currentSha256 })
      return { success: true, contentItems: [
        { type: 'inputText', text: JSON.stringify({ width: SIZE, height: SIZE, allowed_rect: scopeRect, codebook_hash: codebookHash,
          saved: false, drawing_batches: batches, remaining_drawing_batches: 3 - batches,
          source_sha256: sourceSha256, candidate_sha256: currentSha256, sha256: currentSha256 }) },
        { type: 'inputImage', imageUrl: imageUrl() },
      ] }
    },
    async candidate() {
      if (signal?.aborted) fail('assistant_cancelled')
      await checkCurrent()
      if (signal?.aborted) fail('assistant_cancelled')
      return {
        width: SIZE,
        height: SIZE,
        rgba_hex: Buffer.from(pixels).toString('hex'),
        sha256: digest(pixels),
        source_sha256: sourceSha256,
        allowed_rect: scopeRect,
        allowed_operations: allowedOps,
        codebook_hash: codebookHash,
        codebook_version: PIXEL_CODEBOOK_VERSION,
        ...(frozenTarget ? { target: frozenTarget } : {}),
        ...(grantId ? { grant_id: grantId } : {}),
        drawing_batches: batches,
        tool_calls: Math.min(calls, 9),
        trace: [...trace],
      }
    },
  }
}
