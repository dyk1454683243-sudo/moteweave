import { createEmptyFrameRepairState } from './frameRepairState.js'

export { createEmptyFrameRepairState }

export function createEmptyLocalRepairState() {
  return {
    selection: null,
    sourceContext: null,
    profile: null,
    draft: null,
    validationContext: null,
    lastValidCanonical: null,
    validation: { status: 'fail', blocking_errors: ['repair_not_open'], invalidPaths: [] },
    draftHashGeneration: 0,
    currentDraftSettingsHash: null,
    preview: null,
    previewModel: {
      state: 'no_preview',
      frames: [],
      modeAvailability: {},
      acceptance: { canAccept: false, reason: 'no_preview' },
      diagnostics: [],
    },
    acceptInFlight: false,
    warningConfirmation: null,
    filmstrip: { frames: [], selectedIndex: 0, playing: false },
    renderFrame: null,
    differenceCache: new Map(),
    view: {
      clipId: '',
      frameIndex: null,
      mode: 'before',
      zoom: 1,
      pan: { x: 0, y: 0 },
      overlays: { cuts: true, anchor: true, baseline: true, bbox: true, debug: false },
    },
    status: 'idle',
    message: '',
    diagnostics: [],
    error: null,
    openGeneration: 0,
  }
}

export const editorState = {
  project: null,
  dirty: false,
  selectedAssetId: null,
  selectedLayerId: null,
  activePanel: 'layers',
  sceneHistories: {},
  animationRuntime: {
    playing: false,
    last_tick_ms: 0,
    layer_clocks: {},
  },
  repair: {
    local: createEmptyLocalRepairState(),
    frame: createEmptyFrameRepairState(),
    aiAction: {
      selectedAction: '',
      providerPresetId: '',
      imageSize: '1K',
      plan: null,
      job: null,
      importResult: null,
      status: 'idle',
      message: '',
      assetId: null,
      revisionId: null,
    },
  },
  playtest: {
    running: false,
    runtime: null,
    playerLayerId: '',
    options: {
      moveSpeed: 72,
      animationRate: 1,
      cameraZoom: null,
      movingFollowSeconds: 0.18,
      stoppedSettleSeconds: 0.3,
      cameraClamp: true,
    },
    pressedKeys: new Set(),
    lastTickMs: null,
    diagnostics: [],
    eventType: 'near_key',
    key: 'KeyE',
    point: { x: 0, y: 0 },
  },
  sceneRender: {
    status: 'idle',
    result: null,
    token: 0,
    signature: '',
    error: '',
  },
  sceneClipboard: null,
  flow: {
    linkFromSceneId: '',
    linkToSceneId: '',
    linkLabel: '',
  },
  exportPack: {
    status: 'idle',
    message: '',
    result: null,
    handoff: {
      manifest: null,
      godot: null,
      ldtk: null,
      error: '',
    },
    reviewTab: 'manifest',
    previewSceneId: '',
  },
  stage: {
    gridVisible: true,
    snapEnabled: true,
    snapSize: 16,
    width: 0,
    height: 0,
  },
  drag: null,
  log: [],
}

export function addEditorLog(message) {
  editorState.log = [
    { time: new Date().toLocaleTimeString(), message },
    ...editorState.log,
  ].slice(0, 24)
}
