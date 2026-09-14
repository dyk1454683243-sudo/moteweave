export function createEmptyActionRepairSelectionState() {
  return {
    selection: null,
    frameBatchRepairTargets: null,
    clips: {},
    sourceSheetUrl: null,
    filmstrip: { frames: [], selectedIndex: 0, playing: false },
    view: { clipId: '', frameIndex: null },
    status: 'idle',
    message: '',
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
    local: createEmptyActionRepairSelectionState(),
    aiAction: {
      selectedAction: '',
      selectedRegionKeys: [],
      instruction: 'Correct the selected action slots while preserving the character identity.',
      equipmentPolicy: 'none',
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
