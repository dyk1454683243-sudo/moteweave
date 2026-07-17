import { encodeRgbaPng } from '../character-pack/imageCodec.js'
import {
  buildAnimationsJson,
  buildEditorMetadataJson,
  buildMetadataJson,
} from '../character-pack/packageBuilder.js'
import { TOPDOWN_RPG_V0 } from '../character-pack/profile.js'
import { createAssetRef, createAssetRevision } from './assets.js'
import { createVerifiedCharacterRevisionCaptureForQualityGate } from './artifactRegistry.js'
import { FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS } from './frameRepairQualityGateProtocol.js'

const FIXED_TIMESTAMP = '2026-07-12T00:00:00.000Z'
const FRAME_SIZE = 96
const SHEET_SIZE = 768
const FRAME_COUNT = 64
const RGBA_CHANNELS = 4

const COLORS = Object.freeze({
  outline: Object.freeze([18, 31, 38, 255]),
  teal: Object.freeze([36, 144, 132, 255]),
  tealLight: Object.freeze([55, 174, 156, 255]),
  face: Object.freeze([236, 177, 124, 255]),
  foot: Object.freeze([25, 74, 78, 255]),
  transparent: Object.freeze([0, 0, 0, 0]),
})

const COLUMN_SWAY = Object.freeze([-2, -1, 0, 1, 2, 1, 0, -1])
const COLUMN_STEP = Object.freeze([0, -1, 0, 1, 0, 1, 0, -1])

const CONTROL_CONFIG = Object.freeze({
  control_outline_alpha: Object.freeze({
    sourceJobId: 'quality_gate_control_outline_alpha_v1',
    name: 'Quality Gate Outline Alpha Control',
    description: 'Repository-owned deterministic control with one intentional outline and alpha-edge defect.',
    warning: 'intentional_outline_alpha_defect',
    diagnosticMessage: 'Repository-owned deterministic control contains one intentionally seeded outline and alpha-edge defect.',
  }),
  control_small_component: Object.freeze({
    sourceJobId: 'quality_gate_control_small_component_v1',
    name: 'Quality Gate Small Component Control',
    description: 'Repository-owned deterministic control with one intentional detached small-component defect.',
    warning: 'intentional_small_component_defect',
    diagnosticMessage: 'Repository-owned deterministic control contains one intentionally seeded detached small-component defect.',
  }),
})

const ARTIFACT_FILES = Object.freeze({
  sheet: 'normalized_sheet.png',
  animations: 'animations.json',
  metadata: 'metadata.json',
  editor_metadata: 'editor_metadata.json',
  debug_report: 'debug_report.json',
})

export const FRAME_REPAIR_QUALITY_GATE_CONTROL_IDS = Object.freeze([
  'control_outline_alpha',
  'control_small_component',
])

function assertIntegerGeometry(...values) {
  if (values.some((value) => !Number.isInteger(value))) {
    throw new TypeError('control renderer geometry must use integers')
  }
}

function setPixel(data, width, height, x, y, color) {
  assertIntegerGeometry(width, height, x, y)
  if (x < 0 || x >= width || y < 0 || y >= height) return
  const offset = (y * width + x) * RGBA_CHANNELS
  data[offset] = color[0]
  data[offset + 1] = color[1]
  data[offset + 2] = color[2]
  data[offset + 3] = color[3]
}

function fillRect(data, width, height, x, y, rectWidth, rectHeight, color) {
  assertIntegerGeometry(width, height, x, y, rectWidth, rectHeight)
  const left = Math.max(0, x)
  const top = Math.max(0, y)
  const right = Math.min(width, x + Math.max(0, rectWidth))
  const bottom = Math.min(height, y + Math.max(0, rectHeight))
  for (let pixelY = top; pixelY < bottom; pixelY += 1) {
    for (let pixelX = left; pixelX < right; pixelX += 1) {
      setPixel(data, width, height, pixelX, pixelY, color)
    }
  }
}

function drawControlCharacter(data, frameIndex) {
  const column = frameIndex % TOPDOWN_RPG_V0.grid.columns
  const frameX = column * FRAME_SIZE
  const frameY = Math.floor(frameIndex / TOPDOWN_RPG_V0.grid.columns) * FRAME_SIZE
  const sway = COLUMN_SWAY[column]
  const step = COLUMN_STEP[column]

  const bodyX = frameX + 40 + sway
  fillRect(data, SHEET_SIZE, SHEET_SIZE, bodyX, frameY + 48, 23, 31, COLORS.outline)
  fillRect(data, SHEET_SIZE, SHEET_SIZE, bodyX + 2, frameY + 50, 19, 27, COLORS.teal)
  fillRect(data, SHEET_SIZE, SHEET_SIZE, bodyX + 5, frameY + 52, 13, 18, COLORS.tealLight)

  const headX = frameX + 43 + sway
  fillRect(data, SHEET_SIZE, SHEET_SIZE, headX, frameY + 30, 17, 18, COLORS.outline)
  fillRect(data, SHEET_SIZE, SHEET_SIZE, headX + 2, frameY + 32, 13, 13, COLORS.face)
  setPixel(data, SHEET_SIZE, SHEET_SIZE, headX + 5, frameY + 38, COLORS.outline)
  setPixel(data, SHEET_SIZE, SHEET_SIZE, headX + 11, frameY + 38, COLORS.outline)

  const leftFootX = frameX + 43 + sway - step
  const rightFootX = frameX + 54 + sway + step
  fillRect(data, SHEET_SIZE, SHEET_SIZE, leftFootX, frameY + 77, 6, 11, COLORS.outline)
  fillRect(data, SHEET_SIZE, SHEET_SIZE, leftFootX + 1, frameY + 78, 4, 8, COLORS.foot)
  fillRect(data, SHEET_SIZE, SHEET_SIZE, rightFootX, frameY + 77, 6, 11, COLORS.outline)
  fillRect(data, SHEET_SIZE, SHEET_SIZE, rightFootX + 1, frameY + 78, 4, 8, COLORS.foot)
}

function controlCase(caseId) {
  const value = FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS.find(
    (entry) => entry.caseId === caseId,
  )
  if (!value || value.maskEdits.length !== 1 || value.maskEdits[0].op !== 'add_rectangle') {
    throw new Error(`missing fixed control authority for ${caseId}`)
  }
  return value
}

function seedOutlineAlphaDefect(data, definition) {
  const rectangle = definition.maskEdits[0]
  const frameX = (definition.sheetFrameIndex % TOPDOWN_RPG_V0.grid.columns) * FRAME_SIZE
  const frameY = Math.floor(definition.sheetFrameIndex / TOPDOWN_RPG_V0.grid.columns) * FRAME_SIZE
  for (let y = rectangle.y + 4; y < rectangle.y + 9; y += 1) {
    setPixel(data, SHEET_SIZE, SHEET_SIZE, frameX + rectangle.x, frameY + y, COLORS.transparent)
  }
  setPixel(
    data,
    SHEET_SIZE,
    SHEET_SIZE,
    frameX + rectangle.x,
    frameY + rectangle.y + 9,
    [COLORS.outline[0], COLORS.outline[1], COLORS.outline[2], 96],
  )
}

function seedSmallComponentDefect(data, definition) {
  const rectangle = definition.maskEdits[0]
  const frameX = (definition.sheetFrameIndex % TOPDOWN_RPG_V0.grid.columns) * FRAME_SIZE
  const frameY = Math.floor(definition.sheetFrameIndex / TOPDOWN_RPG_V0.grid.columns) * FRAME_SIZE
  fillRect(
    data,
    SHEET_SIZE,
    SHEET_SIZE,
    frameX + rectangle.x + 6,
    frameY + rectangle.y + 4,
    2,
    2,
    COLORS.outline,
  )
}

function renderControlSheet(definition) {
  const data = new Uint8ClampedArray(SHEET_SIZE * SHEET_SIZE * RGBA_CHANNELS)
  for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex += 1) {
    drawControlCharacter(data, frameIndex)
  }
  if (definition.caseId === 'control_outline_alpha') {
    seedOutlineAlphaDefect(data, definition)
  } else {
    seedSmallComponentDefect(data, definition)
  }
  return data
}

function extractFrameRgba(sheet, frameIndex) {
  const data = new Uint8ClampedArray(FRAME_SIZE * FRAME_SIZE * RGBA_CHANNELS)
  const frameX = (frameIndex % TOPDOWN_RPG_V0.grid.columns) * FRAME_SIZE
  const frameY = Math.floor(frameIndex / TOPDOWN_RPG_V0.grid.columns) * FRAME_SIZE
  for (let y = 0; y < FRAME_SIZE; y += 1) {
    const sourceStart = ((frameY + y) * SHEET_SIZE + frameX) * RGBA_CHANNELS
    const targetStart = y * FRAME_SIZE * RGBA_CHANNELS
    data.set(sheet.subarray(sourceStart, sourceStart + FRAME_SIZE * RGBA_CHANNELS), targetStart)
  }
  return data
}

function measureOpaqueBounds(rgba, width = FRAME_SIZE, height = FRAME_SIZE) {
  let left = width
  let top = height
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (rgba[(y * width + x) * RGBA_CHANNELS + 3] === 0) continue
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
  }
  if (right < left || bottom < top) return null
  return {
    x: left,
    y: top,
    w: right - left + 1,
    h: bottom - top + 1,
    right,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  }
}

function deriveClips(animations) {
  return Object.fromEntries(Object.entries(animations.animations).map(([id, animation]) => [id, {
    id,
    source: 'animations.json',
    frames: [...animation.frames],
    fps: animation.fps,
    loop_mode: animation.mode,
    frame_size: { ...animations.frame_size },
    anchor: { ...animations.anchor },
  }]))
}

function jsonBuffer(value) {
  return Buffer.from(JSON.stringify(value), 'utf8')
}

function controlledArtifactRefs(assetId) {
  const base = `workspace/projects/project_quality_gate_controls/assets/${assetId}/rev_001`
  return Object.fromEntries(Object.entries(ARTIFACT_FILES).map(([key, fileName]) => [
    key,
    `${base}/${fileName}`,
  ]))
}

async function buildControlCapture(caseId) {
  const definition = controlCase(caseId)
  const config = CONTROL_CONFIG[caseId]
  const sheetData = renderControlSheet(definition)
  const animations = buildAnimationsJson(TOPDOWN_RPG_V0)
  const metadata = buildMetadataJson({
    id: config.sourceJobId,
    name: config.name,
    description: config.description,
    createdAt: FIXED_TIMESTAMP,
    source: { type: 'local_procedural', input: null },
    generation: { provider: null, model: null, prompt_file: null },
    quality: {
      status: 'warning',
      warnings: [config.warning],
      blocking_errors: [],
    },
    profile: TOPDOWN_RPG_V0,
  })
  const frames = Array.from({ length: FRAME_COUNT }, (_, index) => {
    const rgba = extractFrameRgba(sheetData, index)
    return {
      index,
      normalized_anchor: { x: 48, y: 88 },
      normalized_bbox: measureOpaqueBounds(rgba),
      source_meta: { source_layout: TOPDOWN_RPG_V0.id },
    }
  })
  const editorMetadata = buildEditorMetadataJson({
    metadata,
    animationsJson: animations,
    frames,
    profile: TOPDOWN_RPG_V0,
  })
  const debugReport = {
    profile: TOPDOWN_RPG_V0.id,
    created_at: FIXED_TIMESTAMP,
    validation: {
      status: 'warning',
      warnings: [config.warning],
      blocking_errors: [],
      diagnostics: [{
        code: config.warning,
        severity: 'warning',
        source: 'repository_control',
        message: config.diagnosticMessage,
      }],
    },
  }
  const artifacts = {
    sheet: await encodeRgbaPng({ width: SHEET_SIZE, height: SHEET_SIZE, data: sheetData }),
    animations: jsonBuffer(animations),
    metadata: jsonBuffer(metadata),
    editor_metadata: jsonBuffer(editorMetadata),
    debug_report: jsonBuffer(debugReport),
  }
  const revision = createAssetRevision({
    id: 'rev_001',
    sourceJobId: config.sourceJobId,
    parentRevisionId: null,
    createdAt: FIXED_TIMESTAMP,
    qualityStatus: 'warning',
    productionStatus: 'review_required',
    processingRecipeRef: null,
    artifacts: controlledArtifactRefs(definition.assetId),
  })
  const asset = createAssetRef({
    id: definition.assetId,
    kind: 'character_pack',
    name: config.name,
    profile: TOPDOWN_RPG_V0.id,
    revision,
    provenance: { source_type: 'local_procedural', provider: null, model: null },
    clips: deriveClips(animations),
    tags: ['repository-owned', 'quality-gate-control', 'not-production-art'],
  })
  return createVerifiedCharacterRevisionCaptureForQualityGate({
    asset,
    revision: asset.revisions.rev_001,
    artifacts,
  })
}

export async function buildFrameRepairQualityGateControls() {
  const controls = []
  for (const caseId of FRAME_REPAIR_QUALITY_GATE_CONTROL_IDS) {
    controls.push(await buildControlCapture(caseId))
  }
  return Object.freeze(controls)
}
