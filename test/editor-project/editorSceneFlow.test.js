import test from 'node:test'
import assert from 'node:assert/strict'

import {
  addSceneFlowLink,
  buildSceneFlowBoard,
  buildSceneFlowDiagnostics,
  copySceneForClipboard,
  createBlankSceneInProject,
  createDefaultEditorProject,
  createInteractionDocument,
  createLayerDocument,
  duplicateScene,
  normalizeSceneFlowLayout,
  pasteSceneFromClipboard,
  removeSceneFlowLink,
  updateSceneFlowNode,
  validateEditorProject,
} from '../../src/editor-project/index.js'

const timestamp = '2026-06-22T00:00:00.000Z'

function makeProject() {
  const project = createDefaultEditorProject({
    id: 'project_demo',
    name: 'Demo Project',
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  project.scenes.scene_main.layers.push(createLayerDocument({
    id: 'layer_door',
    name: 'Door',
    type: 'prop',
    assetId: 'asset_missing',
    transform: {
      position: { x: 0, y: 0 },
      scale: { x: 1, y: 1 },
      rotation_deg: 0,
      pivot: { mode: 'center', name: null, x: null, y: null },
      coordinate_space: 'world',
      flip_x: false,
      flip_y: false,
    },
    render: { z_index: 0, opacity: 1, parallax: 1, blend_mode: 'normal' },
    interaction: createInteractionDocument({
      trigger: { type: 'near_key', key: 'KeyE' },
      actions: [{ type: 'scene_link', target_scene_id: 'scene_room', target_spawn_id: 'spawn_room' }],
    }),
  }))
  project.scenes.scene_room = {
    ...project.scenes.scene_main,
    id: 'scene_room',
    name: 'Room',
    layers: [],
    entities: [{ id: 'spawn_room', type: 'spawn_point', position: { x: 24, y: 32 } }],
  }
  project.scene_flow.nodes.scene_room = { x: 460, y: 60, w: 320, h: 180 }
  return project
}

test('scene flow board reports cards, validation badges, and untracked interaction links', () => {
  const project = makeProject()
  const board = buildSceneFlowBoard(project)

  assert.deepEqual(board.cards.map((card) => card.id), ['scene_main', 'scene_room'])
  assert.equal(board.cards.find((card) => card.id === 'scene_main').validation.status, 'fail')
  assert.equal(board.diagnostics.untracked_interaction_links.length, 1)
  assert.equal(board.diagnostics.untracked_interaction_links[0].to_scene_id, 'scene_room')
})

test('scene flow helpers add and remove explicit links', () => {
  let project = makeProject()
  project.assets.asset_missing = {
    id: 'asset_missing',
    kind: 'static_image',
    name: 'Door',
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
        artifacts: { image: 'workspace/projects/project_demo/assets/asset_missing/rev_001/door.png' },
      },
    },
    provenance: { source_type: 'manual_import', provider: null, model: null },
    clips: {},
    tags: [],
  }

  project = addSceneFlowLink(project, {
    fromSceneId: 'scene_main',
    toSceneId: 'scene_room',
    label: 'Door',
  }, { now: timestamp })
  assert.equal(project.scene_flow.links[0].id, 'link_scene_main_to_scene_room')
  assert.equal(buildSceneFlowDiagnostics(project).untracked_interaction_links.length, 0)
  assert.equal(validateEditorProject(project).status, 'pass')

  project = removeSceneFlowLink(project, 'link_scene_main_to_scene_room', { now: timestamp })
  assert.deepEqual(project.scene_flow.links, [])
})

test('scene duplication, copy, paste, blank create, and layout updates stay validator-safe', () => {
  let project = createDefaultEditorProject({ createdAt: timestamp, updatedAt: timestamp })
  project = duplicateScene(project, 'scene_main', { now: timestamp })
  assert.equal(project.active_scene_id, 'scene_main_copy')
  assert.equal(project.scenes.scene_main_copy.name, 'Main Scene Copy')
  assert.deepEqual(project.scene_flow.nodes.scene_main_copy, { x: 120, y: 100, w: 320, h: 180 })

  const clipboard = copySceneForClipboard(project, 'scene_main')
  project = pasteSceneFromClipboard(project, clipboard, { id: 'scene_extra', name: 'Extra', now: timestamp })
  assert.equal(project.scenes.scene_extra.name, 'Extra')
  project = createBlankSceneInProject(project, { name: 'Start Room', now: timestamp })
  assert.equal(project.active_scene_id, 'start_room')

  project = updateSceneFlowNode(project, 'start_room', { x: 12, y: 24, w: 360, h: 210 }, { now: timestamp })
  assert.deepEqual(project.scene_flow.nodes.start_room, { x: 12, y: 24, w: 360, h: 210 })
  assert.equal(validateEditorProject(project).status, 'pass')
})

test('scene flow normalization repairs missing nodes and broken board links', () => {
  const project = createDefaultEditorProject({ createdAt: timestamp, updatedAt: timestamp })
  project.scenes.scene_room = {
    ...project.scenes.scene_main,
    id: 'scene_room',
    name: 'Room',
    layers: [],
  }
  project.scene_flow.nodes.scene_orphan = { x: 0, y: 0, w: 320, h: 180 }
  project.scene_flow.links.push({
    id: 'link_broken',
    from_scene_id: 'scene_main',
    to_scene_id: 'scene_missing',
  })

  const diagnostics = buildSceneFlowDiagnostics(project)
  assert.deepEqual(diagnostics.missing_node_scene_ids, ['scene_room'])
  assert.deepEqual(diagnostics.orphan_node_ids, ['scene_orphan'])
  assert.equal(diagnostics.broken_links.length, 1)

  const normalized = normalizeSceneFlowLayout(project, { now: timestamp })
  assert.ok(normalized.scene_flow.nodes.scene_room)
  assert.equal(normalized.scene_flow.nodes.scene_orphan, undefined)
  assert.deepEqual(normalized.scene_flow.links, [])
  assert.equal(validateEditorProject(normalized).status, 'pass')
})

test('scene flow validation rejects malformed node and link shapes', () => {
  const nodesProject = createDefaultEditorProject({ createdAt: timestamp, updatedAt: timestamp })
  nodesProject.scene_flow.nodes = []
  const nodeResult = validateEditorProject(nodesProject)
  assert.equal(nodeResult.status, 'fail')
  assert.ok(nodeResult.blocking_errors.includes('scene_flow_nodes_not_object'))

  const linksProject = createDefaultEditorProject({ createdAt: timestamp, updatedAt: timestamp })
  linksProject.scene_flow.links = {}
  const linksResult = validateEditorProject(linksProject)
  assert.equal(linksResult.status, 'fail')
  assert.ok(linksResult.blocking_errors.includes('scene_flow_links_not_array'))

  const labelProject = createDefaultEditorProject({ createdAt: timestamp, updatedAt: timestamp })
  labelProject.scene_flow.links.push({
    id: 'link_scene_main_to_scene_main',
    from_scene_id: 'scene_main',
    to_scene_id: 'scene_main',
    label: 12,
  })
  const labelResult = validateEditorProject(labelProject)
  assert.equal(labelResult.status, 'fail')
  assert.ok(labelResult.blocking_errors.includes('invalid_scene_flow_link_label'))
})
