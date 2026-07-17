# Editor Interaction Protocol v0

**Status:** Draft, documentation-only  
**Owner:** Editor Workspace  
**Introduced:** 2026-06-22

## Purpose

`editor_interaction_v0` describes lightweight scene interactions for future
Editor Workspace playtest and export. It is intentionally small: it supports
simple triggers, conditions, and actions without becoming a full scripting
language.

## Interaction Shape

```json
{
  "version": "editor_interaction_v0",
  "enabled": true,
  "trigger": {
    "type": "near_key",
    "key": "KeyE",
    "radius": 96,
    "zone": {
      "coordinate_space": "owner_local",
      "x": 0,
      "y": 0,
      "w": 64,
      "h": 64
    },
    "condition": {
      "state_key": "has_key",
      "equals": true
    }
  },
  "actions": [
    {
      "type": "play_animation",
      "target_layer_id": "layer_door",
      "clip_id": "open",
      "restart": true
    },
    {
      "type": "set_state",
      "key": "door_open",
      "value": true
    }
  ]
}
```

## Trigger Types

Initial trigger types:

- `auto`
- `near_click`
- `near_key`
- `state`

Reserved later:

- `inventory`
- `collision`
- `timer`
- `animation_event`

## Action Types

Initial action types:

- `show_text`
- `play_animation`
- `toggle_layer`
- `set_state`
- `pickup_item`
- `scene_link`

## Zone Ownership

Interaction zones should have one source of truth.

For visual owners, store the zone inside the owning layer's interaction:

```json
{
  "trigger": {
    "type": "near_key",
    "zone": {
      "coordinate_space": "owner_local",
      "x": -32,
      "y": -64,
      "w": 64,
      "h": 64
    }
  }
}
```

Use `owner_local` by default so the zone follows the visual layer when it moves.
Use `world` only for independent hotspot entities that are not attached to a
visual owner. Spawn points belong in `scene.entities`, not in visual layers.

## Action Schemas

Actions are a discriminated union by `type`.

`show_text`:

```json
{
  "type": "show_text",
  "text": "The door is locked.",
  "duration_ms": 2000
}
```

`play_animation`:

```json
{
  "type": "play_animation",
  "target_layer_id": "layer_door",
  "clip_id": "open",
  "restart": true
}
```

`toggle_layer`:

```json
{
  "type": "toggle_layer",
  "target_layer_id": "layer_hidden_passage",
  "visible": true
}
```

`set_state`:

```json
{
  "type": "set_state",
  "key": "door_open",
  "value": true
}
```

`pickup_item`:

```json
{
  "type": "pickup_item",
  "item_id": "rusty_key",
  "quantity": 1,
  "hide_layer_id": "layer_key"
}
```

`scene_link`:

```json
{
  "type": "scene_link",
  "target_scene_id": "scene_room",
  "target_spawn_id": "spawn_from_hall"
}
```

## Execution Semantics

- Actions execute in array order.
- Runtime should stop the current interaction when it hits a validation/runtime
  error.
- `show_text` does not block later actions unless a future protocol adds a wait
  flag.
- `scene_link` should be the last action in the current interaction.
- `set_state` changes become visible to `state` triggers on the next runtime
  tick.
- Missing target layer, scene, spawn, or clip references are validation errors.

## Runtime State

Playtest runtime state is separate from persistent project state:

```json
{
  "activeSceneId": "scene_main",
  "flags": {},
  "inventory": [],
  "player": {
    "layer_id": "layer_player",
    "x": 0,
    "y": 0
  },
  "camera": {},
  "interactions": {},
  "layerOverrides": {}
}
```

Saving a project must not persist temporary runtime state unless a future
protocol explicitly records a playtest snapshot.

## Conditions

The initial condition form compares a project/runtime state key:

```json
{
  "state_key": "door_open",
  "equals": false
}
```

Future protocols may add `not`, `all`, and `any`, but the first implementation
should keep condition validation simple and deterministic.

## Validation Rules

Reject interactions when:

- version is unknown;
- trigger type is unknown;
- action type is unknown;
- a key code is malformed;
- radius is negative;
- zone dimensions are not positive when a zone is present;
- zone coordinate space is unknown;
- an `owner_local` zone has no visual owner context;
- a target layer id does not exist;
- a target scene id does not exist;
- a target spawn id does not exist;
- a target clip id does not resolve;
- a state key is malformed;
- a `show_text` action has empty text;
- a `pickup_item` quantity is not positive;
- a `scene_link` action is not last when later actions would be skipped;
- an action attempts to write secret or provider configuration fields.

## Non-goals

- No arbitrary JavaScript scripting.
- No plugin execution.
- No physics engine.
- No multiplayer runtime.
- No save-game persistence in this protocol.
