const STATUS_COPY = Object.freeze({
  no_project: 'Create or load a project to configure playtest.',
  no_scene: 'Select a scene to configure playtest.',
  no_player: 'Add a Character Pack as a character layer to choose a player.',
  loading: 'Loading scene and player render assets.',
  blocked_player: 'The selected player layer is hidden, blocked, or unavailable. Start is unavailable.',
  partial: 'Player is ready. One or more non-player layers will be skipped.',
  ready: 'Player and scene assets are ready.',
  running: 'Playtest is running. Use WASD or arrow keys; press Escape to stop.',
  missing_clip: 'The requested directional clip is missing; the last available clip is retained.',
})

export const DEFAULT_PLAYTEST_OPTIONS = Object.freeze({
  moveSpeed: 72,
  animationRate: 1,
  movingFollowSeconds: 0.18,
  stoppedSettleSeconds: 0.3,
  cameraClamp: true,
})

function sceneLayers(scene) {
  return Array.isArray(scene?.layers) ? scene.layers : []
}

export function playerLayerOptions(scene, assets) {
  return sceneLayers(scene)
    .filter((layer) => layer?.type === 'character' && assets?.[layer.asset_id]?.kind === 'character_pack')
    .map((layer) => ({
      value: layer.id,
      label: layer.name || layer.id,
    }))
}

function diagnosticCode(diagnostic) {
  if (typeof diagnostic === 'string') return diagnostic
  return diagnostic?.code ?? diagnostic?.error ?? ''
}

function diagnosticsFor(config) {
  const diagnostics = [
    ...(config.sceneRender?.result?.diagnostics ?? []),
    ...(config.sceneRender?.diagnostics ?? []),
    ...(config.playtest?.diagnostics ?? []),
    ...(config.playtest?.runtime?.diagnostics ?? []),
  ]
  if (config.sceneRender?.error) {
    diagnostics.push({ code: 'scene_render_failed', message: config.sceneRender.error })
  }
  return diagnostics
}

function playerLayerFor(scene, playerLayerId) {
  return sceneLayers(scene).find((layer) => layer.id === playerLayerId) ?? null
}

function isFailedEntry(entry) {
  return Boolean(entry && entry.status !== 'ready')
}

function diagnosticBelongsToPlayer(diagnostic, playerLayer, playerAssetId) {
  return diagnostic?.layer_id === playerLayer?.id || diagnostic?.asset_id === playerAssetId
}

export function getPlaytestPanelState(config = {}) {
  const project = config.project ?? null
  const scene = config.scene ?? null
  const assets = config.assets ?? project?.assets ?? {}
  const playtest = config.playtest ?? {}
  const render = config.sceneRender ?? {}
  const options = playerLayerOptions(scene, assets)
  const preferredLayerId = playtest.playerLayerId || config.selectedLayerId || ''
  const playerLayerId = options.some((option) => option.value === preferredLayerId)
    ? preferredLayerId
    : options[0]?.value ?? ''
  const playerLayer = playerLayerFor(scene, playerLayerId)
  const playerLayerHidden = playerLayer?.visible === false
  const playerAssetId = playerLayer?.asset_id ?? ''
  const playerAsset = assets[playerAssetId]
  const playerRevision = playerAsset?.revisions?.[playerAsset.active_revision_id]
  const playerQualityBlocked = playerRevision?.production_status === 'blocked' || playerRevision?.quality_status === 'fail'
  const renderEntries = render.result?.byAssetId ?? {}
  const playerEntry = playerAssetId ? renderEntries[playerAssetId] : null
  const diagnostics = diagnosticsFor(config)
  const missingClip = diagnostics.some((item) => diagnosticCode(item) === 'missing_directional_clip')
  const playerDiagnostic = diagnostics.some((item) => diagnosticBelongsToPlayer(item, playerLayer, playerAssetId))
  const partialDiagnostics = diagnostics.filter((item) => !diagnosticBelongsToPlayer(item, playerLayer, playerAssetId))

  let status = 'ready'
  if (!project) status = 'no_project'
  else if (!scene) status = 'no_scene'
  else if (!options.length) status = 'no_player'
  else if (render.status === 'idle' || render.status === 'loading') status = 'loading'
  else if (playerLayerHidden || playerQualityBlocked || render.status === 'error' || !playerEntry || isFailedEntry(playerEntry) || playerDiagnostic) status = 'blocked_player'
  else if (playtest.running && missingClip) status = 'missing_clip'
  else if (playtest.running) status = 'running'
  else if (partialDiagnostics.length || Object.values(renderEntries).some((entry) => isFailedEntry(entry))) status = 'partial'

  const running = Boolean(playtest.running)
  return {
    status,
    message: STATUS_COPY[status],
    running,
    canStart: !running && (status === 'ready' || status === 'partial'),
    canStop: running,
    playerOptions: options,
    playerLayerId,
    playerLayer,
    diagnostics,
    partial: partialDiagnostics.length > 0,
  }
}

export function canUsePlaytestInteractions(state = {}) {
  return Boolean(state.running || state.canStart)
}

function interactionValue(value) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export function getInteractionResultSummary(runtime) {
  const message = runtime?.messages?.[0]
  const latestMessage = typeof message === 'string' ? message : message?.text ?? ''
  const flags = Object.entries(runtime?.flags ?? {})
    .map(([key, value]) => `${key}=${interactionValue(value)}`)
  const inventory = (runtime?.inventory ?? [])
    .filter((item) => item?.item_id)
    .map((item) => `${item.item_id} ×${Number(item.quantity) || 0}`)
  const layerOverrides = Object.entries(runtime?.layerOverrides ?? {}).map(([layerId, override]) => {
    const effects = []
    if (override?.visible != null) effects.push(override.visible ? 'visible' : 'hidden')
    if (override?.clip_id) effects.push(`clip=${override.clip_id}`)
    if (override?.playing != null) effects.push(override.playing ? 'playing' : 'paused')
    return `${layerId}: ${effects.join(', ') || 'changed'}`
  })
  return {
    empty: !latestMessage && !flags.length && !inventory.length && !layerOverrides.length,
    latestMessage,
    flags,
    inventory,
    layerOverrides,
  }
}

function element(documentRef, tagName, { id, className, text, attributes } = {}) {
  const node = documentRef.createElement(tagName)
  if (id) node.setAttribute('id', id)
  if (className) node.className = className
  if (text != null) node.textContent = String(text)
  for (const [name, value] of Object.entries(attributes ?? {})) {
    node.setAttribute(name, value)
  }
  return node
}

function heading(documentRef, text, level = 'h3') {
  return element(documentRef, level, { text })
}

function field(documentRef, labelText, input) {
  const wrap = element(documentRef, 'label', { className: 'editor-field' })
  const label = element(documentRef, 'span', { text: labelText })
  wrap.append(label, input)
  return wrap
}

function numberInput(documentRef, {
  id,
  value,
  min,
  max,
  step,
  disabled = false,
  onChange,
}) {
  const input = element(documentRef, 'input', { id })
  input.type = 'number'
  input.value = value == null ? '' : String(value)
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.disabled = disabled
  input.addEventListener('change', () => {
    const next = Number(input.value)
    if (Number.isFinite(next)) onChange(next)
  })
  return input
}

function actionButton(documentRef, { id, text, className = '', disabled = false, onClick }) {
  const button = element(documentRef, 'button', { id, className, text })
  button.type = 'button'
  button.disabled = disabled
  button.addEventListener('click', () => onClick())
  return button
}

function optionNode(documentRef, value, label) {
  const option = element(documentRef, 'option', { text: label })
  option.value = value
  return option
}

function selectInput(documentRef, { id, value, options, disabled = false, onChange }) {
  const select = element(documentRef, 'select', { id })
  for (const option of options) select.append(optionNode(documentRef, option.value, option.label))
  select.value = value ?? ''
  select.disabled = disabled
  select.addEventListener('change', () => onChange(select.value))
  return select
}

function checkboxField(documentRef, { id, label, checked, disabled = false, onChange }) {
  const wrap = element(documentRef, 'label', { className: 'editor-inline-control editor-playtest-checkbox' })
  const input = element(documentRef, 'input', { id })
  input.type = 'checkbox'
  input.checked = Boolean(checked)
  input.disabled = disabled
  input.addEventListener('change', () => onChange(input.checked))
  wrap.append(input, element(documentRef, 'span', { text: label }))
  return wrap
}

function runtimeReadout(documentRef, playtest) {
  const runtime = playtest?.runtime
  const player = runtime?.player
  const readout = element(documentRef, 'div', { className: 'editor-playtest-readout' })
  const values = [
    ['Runtime', playtest?.running ? 'running' : 'stopped'],
    ['Player', player?.layer_id ?? playtest?.playerLayerId ?? '-'],
    ['Clip', player?.clip_id ?? '-'],
    ['Direction', player?.direction ?? '-'],
    ['Position', player ? `${Math.round(player.x)}, ${Math.round(player.y)}` : '-'],
  ]
  for (const [label, value] of values) {
    const row = element(documentRef, 'div', { className: 'editor-kv' })
    row.append(
      element(documentRef, 'span', { text: label }),
      element(documentRef, 'strong', { text: value }),
    )
    readout.append(row)
  }
  return readout
}

function diagnosticText(diagnostic) {
  if (typeof diagnostic === 'string') return diagnostic
  const code = diagnosticCode(diagnostic) || 'unknown_diagnostic'
  const owner = diagnostic?.layer_id ?? diagnostic?.asset_id
  const message = diagnostic?.message
  return [code, owner, message].filter(Boolean).join(' · ')
}

function renderDiagnostics(documentRef, state) {
  const section = element(documentRef, 'section', {
    id: 'editor-playtest-diagnostics',
    className: 'editor-playtest-diagnostics',
    attributes: {
      'aria-live': 'polite',
      'aria-atomic': 'true',
    },
  })
  section.append(heading(documentRef, 'Diagnostics'))
  if (!state.diagnostics.length) {
    section.append(element(documentRef, 'p', { text: 'No playtest diagnostics.' }))
    return section
  }
  const list = element(documentRef, 'ul')
  for (const diagnostic of state.diagnostics) {
    list.append(element(documentRef, 'li', { text: diagnosticText(diagnostic) }))
  }
  section.append(list)
  return section
}

function renderInteractionResults(documentRef, runtime) {
  const summary = getInteractionResultSummary(runtime)
  const section = element(documentRef, 'section', {
    className: 'editor-playtest-interaction-results',
  })
  section.append(heading(documentRef, 'Results', 'h4'))
  if (summary.empty) {
    section.append(element(documentRef, 'p', { text: 'No interaction results yet.' }))
    return section
  }
  for (const [label, value] of [
    ['Latest message', summary.latestMessage || 'None'],
    ['Flags', summary.flags.join(', ') || 'None'],
    ['Inventory', summary.inventory.join(', ') || 'None'],
    ['Layer overrides', summary.layerOverrides.join('; ') || 'None'],
  ]) {
    const row = element(documentRef, 'div', { className: 'editor-kv' })
    row.append(
      element(documentRef, 'span', { text: label }),
      element(documentRef, 'strong', { text: value }),
    )
    section.append(row)
  }
  return section
}

function renderInteractionEvents(documentRef, config, disabled) {
  const interaction = config.interaction ?? {}
  const details = element(documentRef, 'details', {
    id: 'editor-playtest-interaction-events',
    className: 'editor-playtest-interactions',
  })
  details.append(element(documentRef, 'summary', { text: 'Interaction events' }))
  const fields = element(documentRef, 'div', { className: 'editor-playtest-interaction-fields' })
  const eventType = selectInput(documentRef, {
    id: 'editor-playtest-event-type',
    value: interaction.eventType ?? 'near_key',
    options: ['near_key', 'near_click', 'auto', 'state'].map((value) => ({ value, label: value })),
    disabled,
    onChange: interaction.onEventTypeChange ?? (() => {}),
  })
  const key = element(documentRef, 'input', { id: 'editor-playtest-event-key' })
  key.type = 'text'
  key.value = interaction.key ?? 'KeyE'
  key.disabled = disabled || (interaction.eventType ?? 'near_key') !== 'near_key'
  key.addEventListener('change', () => (interaction.onKeyChange ?? (() => {}))(key.value.trim() || 'KeyE'))
  fields.append(
    field(documentRef, 'Event', eventType),
    field(documentRef, 'Key', key),
  )
  const actions = element(documentRef, 'div', { className: 'editor-row-actions' })
  actions.append(
    actionButton(documentRef, {
      id: 'editor-playtest-trigger-event',
      text: 'Trigger',
      disabled: disabled || typeof interaction.onTrigger !== 'function',
      onClick: interaction.onTrigger ?? (() => {}),
    }),
    actionButton(documentRef, {
      id: 'editor-playtest-auto-event',
      text: 'Auto',
      className: 'secondary',
      disabled: disabled || typeof interaction.onAuto !== 'function',
      onClick: interaction.onAuto ?? (() => {}),
    }),
    actionButton(documentRef, {
      id: 'editor-playtest-state-event',
      text: 'State',
      className: 'secondary',
      disabled: disabled || typeof interaction.onState !== 'function',
      onClick: interaction.onState ?? (() => {}),
    }),
  )
  details.append(fields, actions, renderInteractionResults(documentRef, config.playtest?.runtime))
  return details
}

export function renderPlaytestPanel(config = {}) {
  const documentRef = config.document ?? globalThis.document
  if (!documentRef?.createElement) throw new Error('renderPlaytestPanel requires a document')
  const state = getPlaytestPanelState(config)
  const playtest = config.playtest ?? {}
  const options = playtest.options ?? {}
  const onPlayerLayerChange = config.onPlayerLayerChange ?? (() => {})
  const onOptionChange = config.onOptionChange ?? (() => {})
  const onStart = config.onStart ?? (() => {})
  const onStop = config.onStop ?? (() => {})
  const onResetOptions = config.onResetOptions ?? (() => {})

  const wrap = element(documentRef, 'div', { className: 'editor-playtest' })
  const basic = element(documentRef, 'section', { className: 'editor-playtest-basic' })
  basic.append(heading(documentRef, 'Basic'))

  const fields = element(documentRef, 'div', { className: 'editor-playtest-basic-fields' })
  const choices = state.playerOptions.length
    ? state.playerOptions
    : [{ value: '', label: 'No Character Pack layer' }]
  fields.append(
    field(documentRef, 'Player layer', selectInput(documentRef, {
      id: 'editor-playtest-player-layer',
      value: state.playerLayerId,
      options: choices,
      disabled: state.running || !state.playerOptions.length,
      onChange: onPlayerLayerChange,
    })),
    field(documentRef, 'Move speed', numberInput(documentRef, {
      id: 'editor-playtest-move-speed',
      value: options.moveSpeed ?? DEFAULT_PLAYTEST_OPTIONS.moveSpeed,
      min: 1,
      max: 480,
      step: 1,
      onChange: (value) => onOptionChange('moveSpeed', value),
    })),
    field(documentRef, 'Camera zoom', numberInput(documentRef, {
      id: 'editor-playtest-camera-zoom',
      value: options.cameraZoom ?? config.scene?.camera?.zoom ?? 1,
      min: 0.1,
      max: 8,
      step: 0.05,
      onChange: (value) => onOptionChange('cameraZoom', value),
    })),
  )
  const actions = element(documentRef, 'div', { className: 'editor-row-actions editor-playtest-actions' })
  actions.append(
    actionButton(documentRef, {
      id: 'editor-playtest-start',
      text: 'Start',
      disabled: !state.canStart,
      onClick: onStart,
    }),
    actionButton(documentRef, {
      id: 'editor-playtest-stop',
      text: 'Stop',
      className: 'secondary',
      disabled: !state.canStop,
      onClick: onStop,
    }),
  )
  basic.append(fields, actions)

  const advanced = element(documentRef, 'details', {
    id: 'editor-playtest-advanced',
    className: 'editor-playtest-advanced',
  })
  advanced.append(element(documentRef, 'summary', { text: 'Advanced' }))
  const advancedFields = element(documentRef, 'div', { className: 'editor-playtest-advanced-fields' })
  advancedFields.append(
    field(documentRef, 'Animation rate', numberInput(documentRef, {
      id: 'editor-playtest-animation-rate',
      value: options.animationRate ?? DEFAULT_PLAYTEST_OPTIONS.animationRate,
      min: 0.1,
      max: 4,
      step: 0.1,
      onChange: (value) => onOptionChange('animationRate', value),
    })),
    field(documentRef, 'Moving follow', numberInput(documentRef, {
      id: 'editor-playtest-moving-follow',
      value: options.movingFollowSeconds ?? DEFAULT_PLAYTEST_OPTIONS.movingFollowSeconds,
      min: 0.01,
      max: 2,
      step: 0.01,
      onChange: (value) => onOptionChange('movingFollowSeconds', value),
    })),
    field(documentRef, 'Stopped settle', numberInput(documentRef, {
      id: 'editor-playtest-stopped-settle',
      value: options.stoppedSettleSeconds ?? DEFAULT_PLAYTEST_OPTIONS.stoppedSettleSeconds,
      min: 0.01,
      max: 3,
      step: 0.01,
      onChange: (value) => onOptionChange('stoppedSettleSeconds', value),
    })),
    checkboxField(documentRef, {
      id: 'editor-playtest-camera-clamp',
      label: 'Camera clamp',
      checked: options.cameraClamp ?? DEFAULT_PLAYTEST_OPTIONS.cameraClamp,
      onChange: (value) => onOptionChange('cameraClamp', value),
    }),
  )
  advancedFields.append(actionButton(documentRef, {
    id: 'editor-playtest-reset',
    text: 'Reset defaults',
    className: 'secondary',
    onClick: onResetOptions,
  }))
  advanced.append(advancedFields)

  const status = element(documentRef, 'section', {
    id: 'editor-playtest-status',
    className: 'editor-playtest-status',
    attributes: {
      'data-status': state.status,
      'aria-live': 'polite',
      'aria-atomic': 'true',
    },
  })
  status.append(
    heading(documentRef, 'Runtime status'),
    element(documentRef, 'p', { className: 'editor-playtest-status-message', text: state.message }),
    runtimeReadout(documentRef, playtest),
  )

  const keyboardNote = element(documentRef, 'p', {
    id: 'editor-playtest-keyboard-note',
    className: 'editor-playtest-keyboard-note',
    text: 'Hardware keyboard required for movement controls.',
  })

  wrap.append(
    basic,
    advanced,
    renderInteractionEvents(documentRef, config, !canUsePlaytestInteractions(state)),
    status,
    renderDiagnostics(documentRef, state),
    keyboardNote,
  )
  return wrap
}
