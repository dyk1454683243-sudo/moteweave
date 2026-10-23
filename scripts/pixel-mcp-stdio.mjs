// Task-scoped local STDIO MCP server for GameTool external pixel candidate editing.
// Never mutates global agent configurations (~/.codex/config.toml, Cursor, or Claude desktop files).
import { randomUUID } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runPixelToolsCommand } from './pixel-tools-cli.mjs'
import { EXTERNAL_BRIDGE_COMPATIBILITY, MCP_BRIDGE_TOOL_NAMES } from '../src/editor-project/externalPixelSession.js'

export const DEFAULT_MCP_STDIO_SCRIPT_PATH = fileURLToPath(import.meta.url)

const MAX_STDIO_MESSAGE_BYTES = 128 * 1024
const MAX_ARGUMENTS_BYTES = 64 * 1024
const SUPPORTED_PROTOCOL_VERSIONS = Object.freeze(['2025-11-25', '2025-03-26', '2024-11-05'])
const PROHIBITED_TOOLS = new Set(['propose_recipe', 'create_animation_draft', 'save', 'commit'])

const rectSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y', 'w', 'h'],
  properties: {
    x: { type: 'integer', minimum: 0, maximum: EXTERNAL_BRIDGE_COMPATIBILITY.width - 1 },
    y: { type: 'integer', minimum: 0, maximum: EXTERNAL_BRIDGE_COMPATIBILITY.height - 1 },
    w: { type: 'integer', minimum: 1, maximum: EXTERNAL_BRIDGE_COMPATIBILITY.width },
    h: { type: 'integer', minimum: 1, maximum: EXTERNAL_BRIDGE_COMPATIBILITY.height },
  },
}

const optionalOperationId = {
  operation_id: {
    type: 'string',
    description: 'Optional UUIDv4 operation_id for idempotent replay within the same session.',
  },
}

export const MCP_PIXEL_TOOLS = Object.freeze([
  {
    name: 'read_document',
    description: 'Read sanitized target document metadata, compatibility bounds (64x64 single-frame single-layer), frozen codebook, and remaining budgets. Preview only, not saved.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { ...optionalOperationId },
    },
  },
  {
    name: 'read_region',
    description: 'Read a rectangular region inside the authorized scope as a character grid with the frozen 62-symbol session codebook. Preview only, not saved.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...optionalOperationId,
        rect: rectSchema,
      },
    },
  },
  {
    name: 'render_review',
    description: 'Render a deterministic PNG preview of the current unsaved candidate (or a sub-rectangle inside the authorized scope) and return its sha256 and base64 PNG.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...optionalOperationId,
        rect: rectSchema,
      },
    },
  },
  {
    name: 'analyze_pixels',
    description: 'Analyze opaque/transparent pixel counts, non-transparent bounding box, and color frequency palette inside the authorized region of the current candidate.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...optionalOperationId,
        rect: rectSchema,
      },
    },
  },
  {
    name: 'propose_patch',
    description: 'Apply one atomic drawing batch to the unsaved candidate within the authorized scope using either a character-grid patch (rect, grid, codebook_hash, expected_candidate_hash) or bounded native pixel operations.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...optionalOperationId,
        rect: rectSchema,
        grid: {
          type: 'array',
          minItems: 1,
          maxItems: EXTERNAL_BRIDGE_COMPATIBILITY.height,
          items: { type: 'string', minLength: 1, maxLength: EXTERNAL_BRIDGE_COMPATIBILITY.width },
        },
        codebook_hash: { type: 'string', minLength: 64, maxLength: 64 },
        expected_candidate_hash: { type: 'string', minLength: 64, maxLength: 64 },
        target: {
          type: 'object',
          additionalProperties: false,
          required: ['frame_id', 'layer_id', 'cel_id'],
          properties: {
            frame_id: { type: 'string' },
            layer_id: { type: 'string' },
            cel_id: { type: 'string' },
          },
        },
        operations: {
          type: 'array',
          minItems: 1,
          maxItems: 64,
          items: { type: 'object' },
        },
      },
    },
  },
  {
    name: 'preview_patch',
    description: 'Dry-run a character-grid patch without mutating the candidate or consuming a drawing batch, or inspect the current candidate diff against the source.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        ...optionalOperationId,
        rect: rectSchema,
        grid: {
          type: 'array',
          minItems: 1,
          maxItems: EXTERNAL_BRIDGE_COMPATIBILITY.height,
          items: { type: 'string', minLength: 1, maxLength: EXTERNAL_BRIDGE_COMPATIBILITY.width },
        },
        codebook_hash: { type: 'string', minLength: 64, maxLength: 64 },
        expected_candidate_hash: { type: 'string', minLength: 64, maxLength: 64 },
        target: {
          type: 'object',
          additionalProperties: false,
          required: ['frame_id', 'layer_id', 'cel_id'],
          properties: {
            frame_id: { type: 'string' },
            layer_id: { type: 'string' },
            cel_id: { type: 'string' },
          },
        },
      },
    },
  },
  {
    name: 'get_job',
    description: 'Get the current candidate session status, hashes, and remaining budgets. Does not consume or replenish the 9-call edit/read budget.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { ...optionalOperationId },
    },
  },
  {
    name: 'cancel_job',
    description: 'Cancel and close the current unsaved candidate session without modifying the project. Does not consume the 9-call budget.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { ...optionalOperationId },
    },
  },
  {
    name: 'request_acceptance',
    description: 'Seal the unsaved candidate for human review and return the VNext review link. Only the human user can Save or Discard in VNext UI.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { ...optionalOperationId },
    },
  },
])

export const MCP_BRIDGE_INSTRUCTIONS = 'Use the GameTool MCP pixel bridge to inspect and propose edits on the authorized 64x64 single-frame, single-layer canvas target. '
  + 'All mutations stage an unsaved candidate only (up to 3 drawing batches and 9 total read/render/analyze/propose/preview calls per session). '
  + 'Status, cancel, and review sealing (get_job, cancel_job, request_acceptance) remain available after edit budget exhaustion. '
  + 'Call request_acceptance when ready so the human can review and Save or Discard in GameTool.'

export function shellQuoteArg(arg) {
  const str = String(arg ?? '')
  if (str.length > 0 && /^[A-Za-z0-9_./:@=-]+$/.test(str)) return str
  return `'${str.replace(/'/g, `'\\''`)}'`
}

export function formatTaskScopedCodexMcpCommandLine(args) {
  return Array.isArray(args) ? args.map(shellQuoteArg).join(' ') : ''
}

export function parseTaskScopedCodexMcpCommandLine(commandLine) {
  const src = String(commandLine || '').trim()
  if (!src) return []
  const tokens = []
  let current = ''
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inSingle) {
      if (ch === '\'') {
        if (src.slice(i, i + 4) === `'\\''`) {
          current += '\''
          i += 3
        } else {
          inSingle = false
        }
      } else {
        current += ch
      }
    } else if (inDouble) {
      if (ch === '"') {
        inDouble = false
      } else if (ch === '\\' && i + 1 < src.length) {
        current += src[++i]
      } else {
        current += ch
      }
    } else if (ch === '\'') {
      inSingle = true
    } else if (ch === '"') {
      inDouble = true
    } else if (/\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
    } else if (ch === '\\' && i + 1 < src.length) {
      current += src[++i]
    } else {
      current += ch
    }
  }
  if (current.length > 0) tokens.push(current)
  return tokens
}

export function buildTaskScopedCodexMcpCommand({
  url,
  projectId,
  canvasId,
  expectedRevision,
  expectedWorkingRevision,
  grantId,
  bridgeToken = '<BRIDGE_TOKEN>',
  scriptPath = DEFAULT_MCP_STDIO_SCRIPT_PATH,
}) {
  return [
    'node',
    scriptPath,
    '--url', String(url),
    '--project-id', String(projectId),
    '--canvas-id', String(canvasId),
    '--expected-revision', String(expectedRevision),
    '--expected-working-revision', String(expectedWorkingRevision),
    '--grant-id', String(grantId),
    '--bridge-token', String(bridgeToken),
  ]
}

export function createPixelMcpServer({
  url,
  projectId,
  canvasId,
  expectedRevision,
  expectedWorkingRevision,
  grantId,
  bridgeToken,
  sessionId = null,
  frameId,
  layerId,
  celId,
  allowedColors,
  fetchImpl = fetch,
  runCommand = runPixelToolsCommand,
} = {}) {
  let activeSessionId = sessionId || null
  let createOperationId = null
  let sessionOpening = null

  async function ensureSession() {
    if (activeSessionId) return activeSessionId
    if (sessionOpening) return sessionOpening
    createOperationId ||= randomUUID()
    sessionOpening = (async () => {
      const createInput = {
        action: 'create',
        operation_id: createOperationId,
        project_id: projectId,
        canvas_id: canvasId,
        expected_revision: Number(expectedRevision),
        expected_working_revision: Number(expectedWorkingRevision),
        ...(grantId ? { grant_id: grantId } : {}),
        ...(bridgeToken ? { bridge_token: bridgeToken } : {}),
        ...(frameId ? { frame_id: frameId } : {}),
        ...(layerId ? { layer_id: layerId } : {}),
        ...(celId ? { cel_id: celId } : {}),
        ...(Array.isArray(allowedColors) ? { allowed_colors: allowedColors } : {}),
      }
      const created = await runCommand(createInput, { url, fetchImpl, describe: false })
      activeSessionId = created.session_id
      return activeSessionId
    })()
    try {
      return await sessionOpening
    } finally {
      sessionOpening = null
    }
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const HEX64_RE = /^[a-f0-9]{64}$/i
  const RESERVED_TRANSPORT_KEYS = new Set([
    'action',
    'project_id',
    'session_id',
    'bridge_token',
    'grant_id',
    'canvas_id',
    'expected_revision',
    'expected_working_revision',
    'tool',
    'url',
    'frame_id',
    'layer_id',
    'cel_id',
    'allowed_colors',
  ])

  function validateToolArguments(toolDef, rawArgs) {
    if (!toolDef || !rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
      return { valid: false, field: 'arguments' }
    }
    const allowedProps = toolDef.inputSchema?.properties || {}
    for (const key of Object.keys(rawArgs)) {
      if (RESERVED_TRANSPORT_KEYS.has(key) || !Object.prototype.hasOwnProperty.call(allowedProps, key)) {
        return { valid: false, field: key }
      }
    }
    if (rawArgs.operation_id !== undefined) {
      if (typeof rawArgs.operation_id !== 'string' || !UUID_RE.test(rawArgs.operation_id)) {
        return { valid: false, field: 'operation_id' }
      }
    }
    if (rawArgs.rect !== undefined) {
      const r = rawArgs.rect
      if (!r || typeof r !== 'object' || Array.isArray(r)) return { valid: false, field: 'rect' }
      const keys = Object.keys(r)
      if (keys.length !== 4 || keys.some(k => !['x', 'y', 'w', 'h'].includes(k))) {
        return { valid: false, field: 'rect' }
      }
      if (!Number.isSafeInteger(r.x) || r.x < 0 || r.x >= EXTERNAL_BRIDGE_COMPATIBILITY.width
        || !Number.isSafeInteger(r.y) || r.y < 0 || r.y >= EXTERNAL_BRIDGE_COMPATIBILITY.height
        || !Number.isSafeInteger(r.w) || r.w < 1 || r.w > EXTERNAL_BRIDGE_COMPATIBILITY.width
        || !Number.isSafeInteger(r.h) || r.h < 1 || r.h > EXTERNAL_BRIDGE_COMPATIBILITY.height) {
        return { valid: false, field: 'rect' }
      }
    }
    if (rawArgs.grid !== undefined) {
      if (!Array.isArray(rawArgs.grid) || rawArgs.grid.length < 1 || rawArgs.grid.length > EXTERNAL_BRIDGE_COMPATIBILITY.height
        || rawArgs.grid.some(row => typeof row !== 'string' || row.length < 1 || row.length > EXTERNAL_BRIDGE_COMPATIBILITY.width)) {
        return { valid: false, field: 'grid' }
      }
    }
    if (rawArgs.codebook_hash !== undefined) {
      if (typeof rawArgs.codebook_hash !== 'string' || !HEX64_RE.test(rawArgs.codebook_hash)) {
        return { valid: false, field: 'codebook_hash' }
      }
    }
    if (rawArgs.expected_candidate_hash !== undefined) {
      if (typeof rawArgs.expected_candidate_hash !== 'string' || !HEX64_RE.test(rawArgs.expected_candidate_hash)) {
        return { valid: false, field: 'expected_candidate_hash' }
      }
    }
    if (rawArgs.target !== undefined) {
      const t = rawArgs.target
      if (!t || typeof t !== 'object' || Array.isArray(t)) return { valid: false, field: 'target' }
      const keys = Object.keys(t)
      if (keys.length !== 3 || keys.some(k => !['frame_id', 'layer_id', 'cel_id'].includes(k))
        || typeof t.frame_id !== 'string' || !t.frame_id
        || typeof t.layer_id !== 'string' || !t.layer_id
        || typeof t.cel_id !== 'string' || !t.cel_id) {
        return { valid: false, field: 'target' }
      }
    }
    if (rawArgs.operations !== undefined) {
      if (!Array.isArray(rawArgs.operations) || rawArgs.operations.length < 1 || rawArgs.operations.length > 64
        || rawArgs.operations.some(op => !op || typeof op !== 'object' || Array.isArray(op))) {
        return { valid: false, field: 'operations' }
      }
    }
    return { valid: true }
  }

  async function handleToolCall(params) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: 'invalid_pixel_tool_request', saved: false }) }],
      }
    }
    const name = params.name
    const rawArgs = params.arguments ?? {}
    if (PROHIBITED_TOOLS.has(name) || !MCP_BRIDGE_TOOL_NAMES.includes(name)) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'assistant_tool_blocked',
            diagnostic: {
              reason: PROHIBITED_TOOLS.has(name) ? 'prohibited' : 'authorization',
              rule: 'tool_identity',
              terminal: true,
            },
            saved: false,
          }),
        }],
      }
    }
    if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: 'invalid_pixel_tool_request', saved: false }) }],
      }
    }
    const serializedArgs = JSON.stringify(rawArgs)
    if (Buffer.byteLength(serializedArgs, 'utf8') > MAX_ARGUMENTS_BYTES) {
      return {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ error: 'invalid_pixel_tool_request', reason: 'arguments_too_large', saved: false }) }],
      }
    }
    const toolDef = MCP_PIXEL_TOOLS.find(t => t.name === name)
    const argCheck = validateToolArguments(toolDef, rawArgs)
    if (!argCheck.valid) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'invalid_pixel_tool_request',
            diagnostic: {
              reason: 'invalid_arguments',
              rule: 'input_schema',
              tool: name,
              field: argCheck.field,
            },
            saved: false,
          }),
        }],
      }
    }
    const { operation_id = randomUUID(), ...toolArgs } = rawArgs
    try {
      const sid = await ensureSession()
      const output = await runCommand(
        {
          ...toolArgs,
          action: name,
          project_id: projectId,
          session_id: sid,
          operation_id,
          ...(bridgeToken ? { bridge_token: bridgeToken } : {}),
        },
        { url, fetchImpl, describe: false },
      )
      const payload = output.observation
        ? { operation_id: output.operation_id, session_id: sid, ...output.observation }
        : { ...output }
      const text = JSON.stringify(payload)
      if (Buffer.byteLength(text, 'utf8') > MAX_STDIO_MESSAGE_BYTES) {
        return {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({ error: 'response_too_large', saved: false }) }],
        }
      }
      return {
        isError: false,
        content: [{ type: 'text', text }],
      }
    } catch (error) {
      return {
        isError: true,
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: error.code || error.message || 'pixel_tool_operation_rejected',
            operation_id: error.operation_id || operation_id,
            saved: false,
            ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}),
          }),
        }],
      }
    }
  }

  async function handleMessage(message) {
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') {
      return {
        jsonrpc: '2.0',
        id: message?.id ?? null,
        error: { code: -32600, message: 'Invalid Request' },
      }
    }
    const { id, method, params } = message
    const isNotification = id === undefined
    if (method === 'notifications/initialized' || method === 'initialized' || method === 'notifications/cancelled') {
      return null
    }
    if (isNotification) return null
    if (method === 'initialize') {
      const requestedVersion = params?.protocolVersion
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
        ? requestedVersion
        : SUPPORTED_PROTOCOL_VERSIONS[0]
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'gametool-pixel-bridge', version: '1.0.0' },
          instructions: MCP_BRIDGE_INSTRUCTIONS,
        },
      }
    }
    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} }
    }
    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: MCP_PIXEL_TOOLS },
      }
    }
    if (method === 'tools/call') {
      const toolResult = await handleToolCall(params)
      return {
        jsonrpc: '2.0',
        id,
        result: toolResult,
      }
    }
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${String(method)}` },
    }
  }

  return {
    handleMessage,
    getSessionId: () => activeSessionId,
  }
}

function parseCliArgs(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--url' && next) options.url = argv[++i]
    else if (arg === '--project-id' && next) options.projectId = argv[++i]
    else if (arg === '--canvas-id' && next) options.canvasId = argv[++i]
    else if (arg === '--expected-revision' && next) options.expectedRevision = Number(argv[++i])
    else if (arg === '--expected-working-revision' && next) options.expectedWorkingRevision = Number(argv[++i])
    else if (arg === '--grant-id' && next) options.grantId = argv[++i]
    else if (arg === '--bridge-token' && next) options.bridgeToken = argv[++i]
    else if (arg === '--session-id' && next) options.sessionId = argv[++i]
    else if (arg === '--frame-id' && next) options.frameId = argv[++i]
    else if (arg === '--layer-id' && next) options.layerId = argv[++i]
    else if (arg === '--cel-id' && next) options.celId = argv[++i]
    else throw new Error(`Invalid argument: ${arg}`)
  }
  if (!options.url || !options.projectId) {
    throw new Error('Required arguments: --url http://127.0.0.1:PORT --project-id <id> [--session-id <uuid> | --canvas-id <id> --expected-revision <n> --expected-working-revision <n> --grant-id <id> --bridge-token <token>]')
  }
  return options
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseCliArgs(process.argv.slice(2))
    const server = createPixelMcpServer(options)
    let buffer = ''
    let queue = Promise.resolve()
    const writeResponse = response => {
      if (!response) return
      const line = JSON.stringify(response)
      process.stdout.write(`${line}\n`)
    }
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      buffer += chunk
      if (Buffer.byteLength(buffer, 'utf8') > MAX_STDIO_MESSAGE_BYTES * 2) {
        writeResponse({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Message exceeds 128 KiB limit' } })
        process.exit(1)
        return
      }
      let newlineIdx
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim()
        buffer = buffer.slice(newlineIdx + 1)
        if (!line || line.startsWith('Content-Length:')) continue
        queue = queue.then(async () => {
          let parsed
          try {
            parsed = JSON.parse(line)
          } catch {
            writeResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
            return
          }
          const response = await server.handleMessage(parsed)
          writeResponse(response)
        })
      }
    })
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ error: error.message || 'mcp_startup_failed' })}\n`)
    process.exitCode = 1
  }
}
