import { EDITOR_INTERACTION_VERSION } from './constants.js'
import { clonePlain } from './safety.js'

export function createInteractionDocument({
  enabled = true,
  trigger = { type: 'auto' },
  actions = [],
} = {}) {
  return {
    version: EDITOR_INTERACTION_VERSION,
    enabled,
    trigger: clonePlain(trigger),
    actions: clonePlain(actions),
  }
}

export function collectInteractionTargetIds(interaction) {
  const ids = {
    layers: new Set(),
    scenes: new Set(),
    spawns: new Set(),
    clips: new Set(),
  }

  for (const action of interaction?.actions ?? []) {
    if (action.target_layer_id) ids.layers.add(action.target_layer_id)
    if (action.hide_layer_id) ids.layers.add(action.hide_layer_id)
    if (action.target_scene_id) ids.scenes.add(action.target_scene_id)
    if (action.target_spawn_id) ids.spawns.add(action.target_spawn_id)
    if (action.clip_id) ids.clips.add(action.clip_id)
  }

  return ids
}
