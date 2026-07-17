import { spawn as defaultSpawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_CELL_SIZE = { w: 96, h: 96 }

function positiveInteger(value, name) {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) throw new Error(`invalid_${name}`)
  return number
}

function normalizeCellSize(cellSize = DEFAULT_CELL_SIZE) {
  const width = Array.isArray(cellSize) ? cellSize[0] : cellSize.w ?? cellSize.width
  const height = Array.isArray(cellSize) ? cellSize[1] : cellSize.h ?? cellSize.height
  return {
    w: positiveInteger(width, 'editor_cell_width'),
    h: positiveInteger(height, 'editor_cell_height'),
  }
}

function normalizeSheetSize({ sheetSize, cellSize, frameCount }) {
  if (sheetSize) {
    return {
      w: positiveInteger(sheetSize.w ?? sheetSize.width, 'editor_sheet_width'),
      h: positiveInteger(sheetSize.h ?? sheetSize.height, 'editor_sheet_height'),
    }
  }
  const count = positiveInteger(frameCount, 'editor_frame_count')
  return { w: cellSize.w * count, h: cellSize.h }
}

function normalizeActionName(action) {
  return String(action ?? 'animation')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'animation'
}

function resolveSpriteEditorPath({ editorPath, env = process.env } = {}) {
  const resolved = editorPath ?? env.SPRITE_EDITOR_PATH
  return typeof resolved === 'string' && resolved.trim() ? resolved.trim() : null
}

export function buildEditorHandoffManifest({
  action = 'walk_down',
  stripPath = 'normalized_motion_strip.png',
  editorJsonPath = 'editor_frames.json',
  frameCount,
  cellSize = DEFAULT_CELL_SIZE,
  sheetSize,
  editorPath = null,
  status = 'ready',
  warnings = [],
} = {}) {
  const normalizedCell = normalizeCellSize(cellSize)
  const normalizedSheet = normalizeSheetSize({ sheetSize, cellSize: normalizedCell, frameCount })
  const count = frameCount === undefined
    ? normalizedSheet.w / normalizedCell.w
    : positiveInteger(frameCount, 'editor_frame_count')
  if (!Number.isInteger(count) || count < 1) throw new Error('invalid_editor_frame_count')
  if (normalizedSheet.w !== normalizedCell.w * count || normalizedSheet.h !== normalizedCell.h) {
    throw new Error('editor_handoff_size_mismatch')
  }

  return {
    schema_version: 1,
    mode: 'motion_source_editor_handoff_manifest_v1',
    status,
    action: normalizeActionName(action),
    claim_boundary: 'Optional local sprite-editor handoff only; no editor binary, plugin, or model is bundled.',
    strip: {
      path: stripPath,
      layout: 'horizontal',
      frame_count: count,
      cell_size: normalizedCell,
      size: normalizedSheet,
    },
    editor_json: {
      path: editorJsonPath,
      format: 'sprite_editor_json_array_v1',
    },
    local_editor: {
      configured: Boolean(editorPath),
      env_var: 'SPRITE_EDITOR_PATH',
      path_configured: Boolean(editorPath),
    },
    reimport_contract: {
      required_same_size: true,
      expected_size: normalizedSheet,
      expected_cell_size: normalizedCell,
      accepted_strip_layout: 'horizontal',
      alpha_required: true,
    },
    warnings: [...warnings],
  }
}

export function buildEditorHandoffCommand({
  editorPath,
  inputPaths = [],
  sheetPath,
  dataPath,
  sheetWidth,
} = {}) {
  if (!editorPath) throw new Error('missing_sprite_editor_path')
  if (!Array.isArray(inputPaths) || inputPaths.length < 1) throw new Error('missing_editor_input_paths')
  if (!sheetPath) throw new Error('missing_editor_sheet_path')
  if (!dataPath) throw new Error('missing_editor_data_path')
  const width = positiveInteger(sheetWidth, 'editor_sheet_width')
  return {
    command: editorPath,
    args: [
      '-b',
      ...inputPaths,
      '--sheet',
      sheetPath,
      '--data',
      dataPath,
      '--format',
      'json-array',
      '--sheet-type',
      'packed',
      '--sheet-width',
      String(width),
    ],
  }
}

function appendChunk(chunks, chunk) {
  if (chunk === undefined || chunk === null) return
  chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk))
}

export async function runOptionalEditorHandoff({
  env = process.env,
  editorPath,
  inputPaths = [],
  sheetPath,
  dataPath,
  sheetWidth,
  cwd = process.cwd(),
  spawn = defaultSpawn,
} = {}) {
  const resolvedPath = resolveSpriteEditorPath({ editorPath, env })
  if (!resolvedPath) {
    return {
      status: 'skipped',
      reason: 'missing_sprite_editor_path',
      command: null,
      env_var: 'SPRITE_EDITOR_PATH',
    }
  }

  const command = buildEditorHandoffCommand({
    editorPath: resolvedPath,
    inputPaths,
    sheetPath,
    dataPath,
    sheetWidth,
  })

  return new Promise((resolve) => {
    const stdout = []
    const stderr = []
    let settled = false
    const child = spawn(command.command, command.args, {
      cwd,
      shell: false,
      windowsHide: true,
    })
    child.stdout?.on?.('data', (chunk) => appendChunk(stdout, chunk))
    child.stderr?.on?.('data', (chunk) => appendChunk(stderr, chunk))
    child.on('error', (error) => {
      if (settled) return
      settled = true
      resolve({
        status: 'failed',
        reason: error.message || String(error),
        command,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
      })
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      resolve({
        status: code === 0 ? 'done' : 'failed',
        exit_code: code,
        reason: code === 0 ? null : 'local_editor_process_failed',
        command,
        stdout: stdout.join(''),
        stderr: stderr.join(''),
      })
    })
  })
}

export async function writeEditorHandoffArtifacts({
  outDir,
  editorFramesJson,
  manifest,
  editorJsonName = 'editor_frames.json',
  manifestName = 'editor_handoff_manifest.json',
} = {}) {
  if (!outDir) throw new Error('missing_editor_handoff_output_dir')
  await mkdir(outDir, { recursive: true })
  const editorFramesPath = path.join(outDir, editorJsonName)
  const manifestPath = path.join(outDir, manifestName)
  await writeFile(editorFramesPath, JSON.stringify(editorFramesJson, null, 2))
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2))
  return {
    editor_frames_json: editorFramesPath,
    editor_handoff_manifest_json: manifestPath,
  }
}
