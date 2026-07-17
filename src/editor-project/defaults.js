import {
  EDITOR_PROJECT_VERSION,
  EDITOR_SCENE_VERSION,
} from './constants.js'
import { clonePlain } from './safety.js'

function normalizeTimestamp(value) {
  if (!value) return new Date().toISOString()
  if (value instanceof Date) return value.toISOString()
  return new Date(value).toISOString()
}

export function createDefaultEditorScene({
  id = 'scene_main',
  name = 'Main Scene',
  world = { w: 1280, h: 720 },
  viewport = { w: 1280, h: 720 },
  camera = { x: 0, y: 0, zoom: 1 },
  background = '#101418',
  createdAt,
  updatedAt = createdAt,
} = {}) {
  const created_at = normalizeTimestamp(createdAt)
  return {
    id,
    version: EDITOR_SCENE_VERSION,
    name,
    world: clonePlain(world),
    viewport: clonePlain(viewport),
    camera: clonePlain(camera),
    background,
    state_defaults: {},
    entities: [],
    layers: [],
    created_at,
    updated_at: normalizeTimestamp(updatedAt ?? created_at),
  }
}

export function createDefaultEditorProject({
  id = 'project_demo',
  name = 'Demo Project',
  revision = 1,
  sceneId = 'scene_main',
  sceneName = 'Main Scene',
  createdAt,
  updatedAt = createdAt,
  settings,
} = {}) {
  const created_at = normalizeTimestamp(createdAt)
  const updated_at = normalizeTimestamp(updatedAt ?? created_at)
  const scene = createDefaultEditorScene({
    id: sceneId,
    name: sceneName,
    createdAt: created_at,
    updatedAt: updated_at,
    viewport: settings?.default_viewport ?? { w: 1280, h: 720 },
    world: settings?.default_viewport ?? { w: 1280, h: 720 },
  })

  return {
    version: EDITOR_PROJECT_VERSION,
    id,
    name,
    revision,
    created_at,
    updated_at,
    active_scene_id: sceneId,
    assets: {},
    scenes: {
      [sceneId]: scene,
    },
    scene_flow: {
      nodes: {
        [sceneId]: { x: 80, y: 60, w: 320, h: 180 },
      },
      links: [],
    },
    settings: {
      pixel_art: true,
      default_snap: 16,
      default_viewport: { w: 1280, h: 720 },
      ...clonePlain(settings),
    },
  }
}
