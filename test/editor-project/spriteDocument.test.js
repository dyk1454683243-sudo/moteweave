import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SPRITE_DOCUMENT_LIMITS,
  createDefaultEditorProjectV1,
  parseCanvasLayoutRequest,
  parseCreateDocumentRequest,
  parseCreateProjectRequest,
  parseImportPngQuery,
  validateAssetRef,
  validateEditorProject,
  validateSpriteDocument,
} from '../../src/editor-project/index.js'

const timestamp = '2026-09-18T00:00:00.000Z'
const operation = '11111111-1111-4111-8111-111111111111'

function validDocument(overrides = {}) {
  return {
    version: 'sprite_document_v1',
    document_id: 'd0123456789abcdef',
    project_id: 'p0123456789abcdef',
    name: 'Hero',
    revision: 1,
    parent_revision: null,
    canvas: { w: 2, h: 2 },
    color: { format: 'rgba8', alpha: 'straight', space: 'srgb' },
    frame_order: ['frame_1'],
    layer_order: ['layer_1'],
    frames: { frame_1: { id: 'frame_1', duration_ms: 125 } },
    layers: { layer_1: { id: 'layer_1', name: 'Layer 1', kind: 'raster', visible: true, locked: false } },
    cels: {
      cel_frame_1_layer_1: {
        id: 'cel_frame_1_layer_1',
        frame_id: 'frame_1',
        layer_id: 'layer_1',
        block: { sha256: 'a'.repeat(64), w: 2, h: 2 },
      },
    },
    tags: [],
    palette: [],
    anchors: [],
    source_ref: null,
    ...overrides,
  }
}

test('v1 project and sprite document reject unknown and client-owned fields', () => {
  const project = createDefaultEditorProjectV1({ createdAt: timestamp, updatedAt: timestamp })
  project.extra = true
  assert.equal(validateEditorProject(project).blocking_errors.includes('unknown_project_field'), true)

  const document = validDocument({ extra: true })
  assert.equal(validateSpriteDocument(document).blocking_errors.includes('unknown_document_field'), true)

  assert.throws(
    () => parseCreateProjectRequest({ operation_id: operation, name: 'A', version: 'editor_project_v1' }),
    /unknown fields|cannot write/,
  )
  assert.throws(
    () => parseCreateDocumentRequest({
      operation_id: operation,
      expected_revision: 1,
      source: {
        asset_id: 'asset_source',
        revision_id: 'rev_001',
        artifact: 'image',
        expected_sha256: 'b'.repeat(64),
      },
      accepted_revision: 1,
    }),
    /unknown fields|cannot write/,
  )
})

test('import-png query and canvas-layout request reject unknown, duplicate, and unsafe values', () => {
  const digest = 'b'.repeat(64)
  const query = new URLSearchParams({
    operation_id: operation,
    expected_revision: '1',
    expected_sha256: digest,
  })
  const parsed = parseImportPngQuery(query, query.toString())
  assert.equal(parsed.payload.action, 'import_png')
  assert.throws(
    () => parseImportPngQuery(new URLSearchParams('foo=1'), 'foo=1'),
    (error) => error.code === 'invalid_request',
  )
  assert.throws(
    () => parseImportPngQuery(
      new URLSearchParams(`operation_id=${operation}&operation_id=${operation}&expected_revision=1&expected_sha256=${digest}`),
      `operation_id=${operation}&operation_id=${operation}&expected_revision=1&expected_sha256=${digest}`,
    ),
    (error) => error.code === 'invalid_request',
  )
  assert.throws(
    () => parseImportPngQuery(new URLSearchParams(`pad=${'x'.repeat(3000)}`), `pad=${'x'.repeat(3000)}`),
    (error) => error.code === 'resource_limit',
  )
  const layout = parseCanvasLayoutRequest({
    operation_id: operation,
    expected_revision: 1,
    positions: [
      { canvas_id: 'cbbbbbbbbbbbbbbb', x: 2, y: -3 },
      { canvas_id: 'caaaaaaaaaaaaaaa', x: 0, y: 0 },
    ],
  })
  assert.equal(layout.positions[0].canvas_id, 'caaaaaaaaaaaaaaa')
  assert.equal(layout.payload.action, 'save_canvas_layout')
  assert.throws(
    () => parseCanvasLayoutRequest({
      operation_id: operation,
      expected_revision: 1,
      positions: [{ canvas_id: 'caaaaaaaaaaaaaaa', x: 1.5, y: 0 }],
    }),
    (error) => error.code === 'invalid_request',
  )
  assert.throws(
    () => parseCanvasLayoutRequest({
      operation_id: operation,
      expected_revision: 1,
      positions: [
        { canvas_id: 'caaaaaaaaaaaaaaa', x: 0, y: 0 },
        { canvas_id: 'caaaaaaaaaaaaaaa', x: 1, y: 1 },
      ],
    }),
    (error) => error.code === 'invalid_request',
  )
})

test('document limits reject oversized expanded RGBA without treating dedup as a bypass', () => {
  const cels = {}
  for (let index = 0; index < 33; index += 1) {
    const id = `cel_${index}`
    cels[id] = {
      id,
      frame_id: 'frame_1',
      layer_id: 'layer_1',
      block: { sha256: 'c'.repeat(64), w: 1024, h: 1024 },
    }
  }
  const result = validateSpriteDocument(validDocument({
    canvas: { w: 1024, h: 1024 },
    cels: {
      ...cels,
      cel_frame_1_layer_1: {
        id: 'cel_frame_1_layer_1',
        frame_id: 'frame_1',
        layer_id: 'layer_1',
        block: { sha256: 'c'.repeat(64), w: 1024, h: 1024 },
      },
    },
  }))
  assert.equal(result.status, 'fail')
  assert.ok(result.blocking_errors.includes('document_resource_limit'))
  assert.equal(SPRITE_DOCUMENT_LIMITS.maxExpandedRgbaBytes, 128 * 1024 * 1024)
})

test('managed asset paths with .. cannot enter a v1-capable project index', () => {
  const result = validateAssetRef({
    id: 'asset_escape',
    kind: 'static_image',
    name: 'Escape',
    active_revision_id: 'rev_001',
    revisions: {
      rev_001: {
        id: 'rev_001',
        source_job_id: null,
        parent_revision_id: null,
        created_at: timestamp,
        quality_status: 'pass',
        production_status: 'ready',
        processing_recipe_ref: null,
        artifacts: { image: '../outside.png' },
      },
    },
    provenance: { source_type: 'manual_import', provider: null, model: null },
    clips: {},
    tags: [],
  })
  assert.equal(result.status, 'fail')
  assert.ok(result.blocking_errors.includes('unsafe_artifact_path'))
})
