import {
  buildRepairOverlayCommands,
  getRepairComparisonAvailability,
  resolveSheetFrameRect,
} from './repairComparisonRenderer.js'
import { createFrameRepairPanel } from './frameRepairPanel.js'
import { createFrameRepairQualityGatePanel } from './frameRepairQualityGatePanel.js'

function node(documentRef, tag, className = '', text = '') {
  const value = documentRef.createElement(tag)
  if (className) value.className = className
  value.textContent = text
  return value
}

function labeledValue(documentRef, label) {
  const wrap = node(documentRef, 'div', 'editor-repair-header-value')
  const title = node(documentRef, 'span', '', label)
  const value = node(documentRef, 'strong')
  wrap.append(title, value)
  return { wrap, value }
}

function capitalized(value) {
  const text = String(value ?? '')
  return text ? text[0].toUpperCase() + text.slice(1) : ''
}

function getPlainPath(value, pathValue) {
  return pathValue.split('.').reduce((cursor, part) => cursor?.[part], value)
}

function commandOverlay(command) {
  return command.overlay ?? (
    command.type === 'anchor' ? 'anchor' :
      command.style === 'baseline' ? 'baseline' :
        command.style === 'bbox' ? 'bbox' :
          command.style === 'debug' ? 'debug' : 'cuts'
  )
}

export const REPAIR_RECIPE_CONTROL_SPECS = Object.freeze([
  { section: 'Cleanup', label: 'Background mode', control: 'background-mode', path: 'background.mode', type: 'select', options: ['auto', 'passthrough', 'flood', 'edge_palette', 'dual_matte'] },
  { section: 'Cleanup', label: 'Background tolerance', control: 'background-tolerance', path: 'background.tolerance', type: 'number', min: 0, max: 80, step: 1 },
  { section: 'Cleanup', label: 'Component cleanup', control: 'component-cleanup', path: 'cleanup.component_cleanup', type: 'checkbox' },
  { section: 'Cleanup', label: 'Minimum alpha', control: 'cleanup-min-alpha', path: 'cleanup.min_alpha', type: 'number', min: 0, max: 80, step: 1 },
  { section: 'Cleanup', label: 'Minimum component area', control: 'cleanup-min-area', path: 'cleanup.min_area', type: 'number', min: 1, max: 64, step: 1 },
  { section: 'Cleanup', label: 'Minimum area ratio', control: 'cleanup-min-ratio', path: 'cleanup.min_area_ratio', type: 'number', min: 0, max: 0.25, step: 0.01 },
  { section: 'Pixel Finishing', label: 'Enabled', control: 'pixel-enabled', path: 'pixel_finishing.enabled', type: 'checkbox' },
  { section: 'Pixel Finishing', label: 'Palette colors', control: 'pixel-max-colors', path: 'pixel_finishing.max_colors', type: 'number', min: 1, max: 256, step: 1 },
  { section: 'Pixel Finishing', label: 'Outline', control: 'pixel-outline', path: 'pixel_finishing.outline', type: 'checkbox' },
  { section: 'Pixel Finishing', label: 'Outline mode', control: 'pixel-outline-mode', path: 'pixel_finishing.outline_mode', type: 'select', options: ['outer', 'inner', 'both', 'none'] },
  { section: 'Advanced correction', label: 'Auto correct', control: 'auto-correct', path: 'correction.auto_correct', type: 'checkbox' },
  { section: 'Advanced correction', label: 'Motion stabilization', control: 'motion-stabilize', path: 'correction.motion_stabilize', type: 'checkbox' },
  { section: 'Advanced correction', label: 'Motion max shift', control: 'motion-max-shift', path: 'correction.motion_max_shift', type: 'number', min: 0, max: 4, step: 1 },
  { section: 'Advanced correction', label: 'Locked animations', control: 'locked-animations', path: 'locked_animations', type: 'multiple' },
  { section: 'Advanced correction', label: 'Style report colors', control: 'style-max-colors', path: 'style_report.max_colors', type: 'number', min: 1, max: 256, step: 1 },
])

const REPAIR_UI_STATES = Object.freeze({
  no_project: ['Load a project to use Repair.', [], false],
  no_asset: ['Select a Character Pack asset to begin.', [], false],
  unsupported_asset: ['Repair is available for Character Pack assets.', [], false],
  loading: ['Loading managed Character Pack artifacts…', [], false],
  missing_artifact: ['A required managed artifact is unavailable.', ['retry'], false],
  unsafe_artifact_path: ['A managed artifact path was rejected.', [], false],
  no_preview: ['Build Preview to compare processed output.', ['build', 'discard'], true],
  dirty: ['Recipe has unbuilt changes.', ['build', 'reset', 'discard'], true],
  invalid_recipe: ['Fix the highlighted Recipe fields before building.', ['reset', 'discard'], true],
  queued: ['Preview queued.', ['discard'], true],
  processing: ['Preview processing.', ['discard'], true],
  ready: ['Preview ready for review.', ['build', 'accept', 'reset', 'discard'], true],
  stale: ['Recipe changed after this Preview.', ['build', 'reset', 'discard'], true],
  warning: ['Review and confirm warnings before accepting.', ['build', 'accept', 'confirm_warning', 'reset', 'discard'], true],
  accepting: ['Accepting revision… Keep this project open until the outcome is known.', [], true],
  blocked_quality: ['Preview failed the quality gate and cannot be accepted.', ['build', 'reset', 'discard'], true],
  failed: ['Preview processing failed. Your draft is unchanged.', ['build', 'reset', 'discard'], true],
  revision_conflict: ['The project changed. Reload before building or accepting.', ['discard'], true],
  asset_revision_conflict: ['The active asset revision changed. Reopen Repair.', ['discard'], true],
  selection_switched: ['Repair context changed; late results were ignored.', [], false],
  accepted: ['Preview accepted as a new immutable revision.', ['discard'], false],
  teardown: ['', [], false],
})

export function buildRepairUiStateModel({
  state,
  errorCode = null,
  details = null,
  draftDirty = false,
  canBuild = false,
  canAccept = false,
  warningConfirmed = false,
}) {
  const [message, actions, retainsDraft] = REPAIR_UI_STATES[state] ?? REPAIR_UI_STATES.failed
  const allowed = new Set(actions)
  return {
    state,
    message,
    actions: [...actions],
    retainsDraft,
    mutatesProject: state === 'accepted',
    announcement: message,
    errorText: errorCode ? `${errorCode}${details ? `: ${details}` : ''}` : '',
    actionAvailability: {
      retry: allowed.has('retry'),
      build: allowed.has('build') && canBuild,
      accept: allowed.has('accept') && canAccept,
      reset: allowed.has('reset') && draftDirty,
      discard: allowed.has('discard'),
      confirmWarning: allowed.has('confirm_warning') && !warningConfirmed,
    },
    tone: ['blocked_quality', 'failed', 'revision_conflict', 'asset_revision_conflict', 'unsafe_artifact_path'].includes(state)
      ? 'blocking'
      : state === 'warning' ? 'warning' : 'neutral',
  }
}

const REPAIR_ERROR_PATHS = Object.freeze({
  invalid_background_mode: ['background.mode'],
  unsupported_workbench_background_mode: ['background.mode'],
  dual_matte_requires_managed_black_matte: ['background.mode'],
  invalid_background_tolerance: ['background.tolerance'],
  invalid_component_cleanup: ['cleanup.component_cleanup'],
  invalid_cleanup_min_alpha: ['cleanup.min_alpha'],
  invalid_cleanup_min_area: ['cleanup.min_area'],
  invalid_cleanup_min_area_ratio: ['cleanup.min_area_ratio'],
  invalid_pixel_finishing_enabled: ['pixel_finishing.enabled'],
  invalid_pixel_finishing_max_colors: ['pixel_finishing.max_colors'],
  invalid_pixel_finishing_outline: ['pixel_finishing.outline'],
  invalid_pixel_finishing_outline_mode: ['pixel_finishing.outline_mode'],
  invalid_auto_correct: ['correction.auto_correct'],
  invalid_motion_stabilize: ['correction.motion_stabilize'],
  invalid_motion_max_shift: ['correction.motion_max_shift'],
  invalid_anchor_offset: ['anchor_offset.x', 'anchor_offset.y'],
  invalid_anchor_x: ['anchor_offset.x'],
  invalid_anchor_y: ['anchor_offset.y'],
  invalid_manual_columns: ['grid.manual_overrides'],
  invalid_manual_rows: ['grid.manual_overrides'],
  manual_grid_unavailable_for_fixed_regions: ['grid.manual_overrides'],
  invalid_frame_adjustments: ['frame_adjustments'],
  invalid_locked_animations: ['locked_animations'],
  unknown_locked_animation: ['locked_animations'],
  unknown_outline_mode: ['pixel_finishing.outline_mode'],
  invalid_style_report_enabled: ['style_report.enabled'],
  invalid_style_report_max_colors: ['style_report.max_colors'],
  style_report_required: ['style_report.enabled'],
  style_report_budget_must_match_pixel_finishing: ['style_report.max_colors'],
  invalid_output_frame_sizes: ['outputs.frame_sizes'],
  workbench_staging_must_be_disabled: ['fixed_region_staging'],
})

export function repairInvalidPaths(blockingErrors = []) {
  return [...new Set(blockingErrors.flatMap((code) => REPAIR_ERROR_PATHS[code] ?? []))]
}

export function createNoPreviewModel({ beforeImage, frames }) {
  const normalizedFrames = Array.isArray(frames) ? frames.filter(Number.isInteger) : []
  const validImage = beforeImage && Number.isInteger(beforeImage.width) && beforeImage.width > 0 &&
    Number.isInteger(beforeImage.height) && beforeImage.height > 0
  const hasFrame = normalizedFrames.length > 0 && validImage
  const beforeRect = hasFrame
    ? { sx: 0, sy: 0, sw: Math.min(96, beforeImage.width), sh: Math.min(96, beforeImage.height) }
    : null
  return {
    state: 'no_preview',
    frames: [...normalizedFrames],
    modeAvailability: getRepairComparisonAvailability({ before: hasFrame ? beforeImage : null, beforeRect, after: null, afterRect: null }),
    acceptance: { canAccept: false, reason: 'no_preview' },
    evidence: null,
    diagnostics: hasFrame
      ? [{ code: 'no_preview', message: 'Build Preview to compare processed output.' }]
      : [{ code: 'selected_clip_has_no_frames', message: 'The selected clip has no frames to display.' }],
  }
}

export function buildRepairDraftOverlayCommands({
  recipe,
  profile,
  frameIndex,
  sourceSize = profile.sheet,
  sourceLayoutKind = 'uniform_grid',
  bbox = null,
  debugAnchor = null,
}) {
  if (!Number.isInteger(frameIndex)) return []
  const adjustment = recipe.frame_adjustments?.[String(frameIndex)] ?? { dx: 0, dy: 0 }
  const grid = sourceLayoutKind === 'uniform_grid'
    ? recipe.grid.manual_overrides ?? {
        columns: Array.from({ length: profile.grid.columns + 1 }, (_, index) => Math.round((sourceSize.width * index) / profile.grid.columns)),
        rows: Array.from({ length: profile.grid.rows + 1 }, (_, index) => Math.round((sourceSize.height * index) / profile.grid.rows)),
      }
    : null
  const inset = { x: 4, y: 4, w: 28, h: 28 }
  const cutCommands = grid
    ? [
        ...grid.columns.map((value) => {
          const x = inset.x + (value / sourceSize.width) * inset.w
          return { type: 'line', x1: x, y1: inset.y, x2: x, y2: inset.y + inset.h, style: 'cut', overlay: 'cuts' }
        }),
        ...grid.rows.map((value) => {
          const y = inset.y + (value / sourceSize.height) * inset.h
          return { type: 'line', x1: inset.x, y1: y, x2: inset.x + inset.w, y2: y, style: 'cut', overlay: 'cuts' }
        }),
      ]
    : []
  return [
    ...buildRepairOverlayCommands({
      anchor: {
        x: profile.anchor.x + recipe.anchor_offset.x + adjustment.dx,
        y: profile.anchor.y + recipe.anchor_offset.y + adjustment.dy,
      },
      baselineY: profile.baselineY + recipe.anchor_offset.y + adjustment.dy,
      bbox,
    }).map((command) => ({ ...command, overlay: commandOverlay(command) })),
    ...cutCommands,
    ...(debugAnchor ? [{ type: 'anchor', x: debugAnchor.x, y: debugAnchor.y, style: 'debug', overlay: 'debug' }] : []),
  ]
}

function overlayDrawer(frameSize) {
  return (ctx, command, viewport, suppliedPixelRatio = 1) => {
    const pixelRatio = Number.isFinite(suppliedPixelRatio) && suppliedPixelRatio > 0 ? suppliedPixelRatio : 1
    const scaleX = viewport.w / frameSize.w
    const scaleY = viewport.h / frameSize.h
    const x = (value) => viewport.x + (value === 'width' ? frameSize.w : value) * scaleX
    const y = (value) => viewport.y + (value === 'height' ? frameSize.h : value) * scaleY
    ctx.save()
    ctx.strokeStyle = command.style === 'baseline'
      ? '#75f0d3'
      : command.style === 'bbox'
        ? '#f3cc7f'
        : command.style === 'debug'
          ? '#8bb9ff'
          : '#ffaaa4'
    ctx.lineWidth = pixelRatio
    if (command.type === 'line') {
      ctx.beginPath()
      ctx.moveTo(x(command.x1), y(command.y1))
      ctx.lineTo(x(command.x2), y(command.y2))
      ctx.stroke()
    }
    if (command.type === 'rect') ctx.strokeRect(x(command.x), y(command.y), command.w * scaleX, command.h * scaleY)
    if (command.type === 'anchor') {
      ctx.beginPath()
      ctx.arc(x(command.x), y(command.y), 3 * pixelRatio, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }
}

export function createInitialRepairRenderFrame({ local, beforeImage }) {
  const frameSize = local.profile.frame
  const hasFrame = Number.isInteger(local.view.frameIndex)
  const beforeRect = hasFrame
    ? resolveSheetFrameRect({
        frameIndex: local.view.frameIndex,
        frameSize,
        sheetSize: { w: beforeImage.width, h: beforeImage.height },
      })
    : null
  return {
    mode: 'before',
    before: hasFrame ? beforeImage : null,
    after: null,
    afterSheet: null,
    beforeRect,
    afterRect: null,
    split: 0.5,
    onionAlpha: 0.5,
    viewport: { x: 0, y: 0, w: frameSize.w, h: frameSize.h },
    differenceImageData: null,
    differenceSource: null,
    frameSize,
    zoom: local.view.zoom,
    pan: local.view.pan,
    playing: false,
    emptyMessage: hasFrame ? null : 'The selected clip has no frames to display.',
    overlayCommands: buildRepairDraftOverlayCommands({
      recipe: local.draft.recipe,
      profile: local.profile,
      frameIndex: local.view.frameIndex,
      sourceSize: local.sourceContext.sourceSize,
      sourceLayoutKind: local.sourceContext.sourceLayoutKind,
    }),
    drawOverlay: overlayDrawer(frameSize),
  }
}

function safeFrameItem({ frameIndex, index, source, frameSize }) {
  try {
    return {
      index,
      frameIndex,
      source,
      available: true,
      rect: resolveSheetFrameRect({
        frameIndex,
        frameSize,
        sheetSize: { w: source.width, h: source.height },
      }),
    }
  } catch {
    return { index, frameIndex, source, available: false, rect: null }
  }
}

function differenceDiagnosticText(diagnostics) {
  if (!Array.isArray(diagnostics)) {
    return 'Difference sidecar: Unavailable until a complete Preview is hydrated.'
  }
  const alpha = diagnostics.find((item) => item.code === 'difference_alpha_only_change')?.pixelCount ?? 0
  const transparent = diagnostics.find((item) => item.code === 'difference_transparent_rgb_only')?.pixelCount ?? 0
  if (!alpha && !transparent) return 'Difference sidecar: no alpha-only or transparent RGB-only changes detected.'
  return `Difference sidecar: ${alpha} alpha-only pixel change(s); ${transparent} transparent RGB-only pixel change(s). These are comparison diagnostics, not blocking taxonomy.`
}

function qualityRowsFor(evidence) {
  const ratio = (value) => value == null ? null : `${(value * 100).toFixed(1)}%`
  const wouldCrop = evidence?.manualAdjustments?.wouldCrop ?? []
  return [
    { label: 'Validation', value: evidence?.validationStatus ?? 'Not built' },
    {
      label: 'Blocking taxonomy',
      value: evidence == null ? null : evidence.failureTaxonomy?.join(', ') || 'None',
    },
    { label: 'Unique colors', value: evidence?.uniqueColors ?? null },
    { label: 'Palette changed', value: ratio(evidence?.paletteChangedRatio) },
    { label: 'Halo pixels before / after', value: evidence?.haloBefore == null || evidence?.haloAfter == null ? null : `${evidence.haloBefore} / ${evidence.haloAfter}` },
    { label: 'Residue pixels before / after', value: evidence?.residueBefore == null || evidence?.residueAfter == null ? null : `${evidence.residueBefore} / ${evidence.residueAfter}` },
    { label: 'Outline ratio', value: ratio(evidence?.outlineRatio) },
    { label: 'Components removed', value: evidence?.componentCleanup?.removed_components ?? null },
    { label: 'Anchor / baseline', value: evidence?.anchor || evidence?.baseline != null ? `${JSON.stringify(evidence.anchor ?? {})} / ${JSON.stringify(evidence.baseline)}` : null },
    { label: 'Motion stabilization', value: evidence?.motionStabilization == null ? null : `${evidence.motionStabilization.applied_count ?? 0} applied` },
    {
      label: 'Would crop',
      value: evidence == null
        ? null
        : wouldCrop.length
          ? `${wouldCrop.length} frame(s); first: frame ${wouldCrop[0].frame}, dx ${wouldCrop[0].dx}, dy ${wouldCrop[0].dy}, not applied (${wouldCrop[0].reason})`
          : 'None',
    },
  ]
}

export function buildRepairWorkbenchViewModel({
  local,
  aiAction,
  asset,
  revision,
  sourceContext,
  profile,
  validation,
  previewModel,
  renderFrame,
  unsavedReason = null,
}) {
  const recipe = local.draft.recipe
  const finishing = recipe.pixel_finishing.enabled === true
  const outline = finishing && recipe.pixel_finishing.outline === true
  const motion = recipe.correction.motion_stabilize === true
  const passthrough = recipe.background.mode === 'passthrough'
  const reviewClips = previewModel.clips ?? asset.clips ?? {}
  const clipEntries = Object.entries(reviewClips).map(([id, value]) => ({ ...value, id }))
  const clip = clipEntries.find((item) => item.id === local.view.clipId) ?? clipEntries[0] ?? { id: '', frames: [], fps: 1 }
  const frameSize = profile.frame
  const filmstripItems = local.filmstrip.frames
    .map((frameIndex, index) => safeFrameItem({ frameIndex, index, source: sourceContext.beforeImage, frameSize }))
  const overlayAvailability = Object.fromEntries(
    ['cuts', 'anchor', 'baseline', 'bbox', 'debug'].map((overlay) => {
      const enabled = renderFrame.overlayCommands.some((command) => commandOverlay(command) === overlay)
      const reason = enabled
        ? null
        : overlay === 'cuts' && sourceContext.sourceLayoutKind === 'fixed_regions'
          ? 'Cut overlay is unavailable for fixed-region sources; no uniform grid is fabricated'
          : overlay === 'cuts' && sourceContext.inputMode !== 'managed_source'
            ? 'Cut overlay is unavailable for normalized-sheet fallback'
            : `${overlay}_overlay_unavailable`
      return [overlay, { enabled, reason }]
    }),
  )
  const visibleOverlayCommands = renderFrame.overlayCommands.filter((command) => local.view.overlays[commandOverlay(command)] === true)
  const evidence = previewModel.evidence ?? null
  const controlAvailability = {
    'background.tolerance': { enabled: !passthrough, reason: passthrough ? 'Passthrough does not use tolerance' : null },
    'pixel_finishing.max_colors': { enabled: finishing, reason: finishing ? null : 'Enable Pixel Finishing first' },
    'pixel_finishing.outline': { enabled: finishing, reason: finishing ? null : 'Enable Pixel Finishing first' },
    'pixel_finishing.outline_mode': { enabled: outline, reason: outline ? null : 'Enable finishing and outline first' },
    'correction.motion_max_shift': { enabled: motion, reason: motion ? null : 'Enable motion stabilization first' },
    'style_report.max_colors': { enabled: !finishing, reason: finishing ? 'Derived from the Pixel Finishing palette budget' : null },
  }
  const adjustment = Number.isInteger(local.view.frameIndex)
    ? recipe.frame_adjustments?.[String(local.view.frameIndex)] ?? { dx: 0, dy: 0 }
    : { dx: 0, dy: 0 }
  const stateBusy = ['queued', 'processing', 'accepting'].includes(previewModel.state)
  const buildReason = unsavedReason ?? (validation.status === 'fail'
    ? validation.blocking_errors?.join(', ') || 'invalid_recipe'
    : stateBusy
      ? 'Wait for the current operation to finish'
      : null)
  const acceptReason = unsavedReason ?? previewModel.acceptance.reason
  const draftDiagnostics = (local.draft.diagnostics ?? []).map((code) => ({ code, message: code }))
  const allDiagnostics = [...draftDiagnostics, ...(previewModel.diagnostics ?? [])]
  const fps = Number.isFinite(clip.fps) && clip.fps > 0 ? clip.fps : 0
  const durationMs = fps > 0 ? (local.filmstrip.frames.length * 1000) / fps : 0
  const selectionKey = `${asset.id}:${revision.id}`
  return {
    assetName: asset.name,
    revisionId: revision.id,
    immutableLabel: 'Immutable current revision',
    previewState: previewModel.state,
    uiState: validation.status === 'fail' ? 'invalid_recipe' : previewModel.state,
    errorCode: local.error?.code ?? null,
    errorDetails: local.error?.details ? JSON.stringify(local.error.details) : local.message,
    stateBanner: ['failed', 'blocked_quality', 'stale'].includes(previewModel.state)
      ? allDiagnostics.map((item) => item.message ?? item.code).join(' · ') || previewModel.state
      : null,
    mode: local.view.mode,
    zoom: local.view.zoom,
    pan: { ...local.view.pan },
    modeAvailability: previewModel.modeAvailability,
    overlays: { ...local.view.overlays },
    overlayAvailability,
    recipe,
    fieldOrigins: local.draft.fieldOrigins,
    sourceSize: sourceContext.sourceSize,
    inputMode: sourceContext.inputMode,
    autoGrid: sourceContext.autoGrid,
    manualGrid: sourceContext.manualGrid,
    invalidPaths: new Set(validation.invalidPaths ?? []),
    frameIndex: local.view.frameIndex,
    selectedFrameAdjustment: adjustment,
    hasSelectedFrame: local.filmstrip.frames.includes(local.view.frameIndex),
    profileAnimations: profile.animations.map((animation) => ({ id: animation.name, label: animation.name })),
    controlAvailability,
    dualMatte: sourceContext.dualMatte,
    fixedStagingProvenance: local.draft.provenance.fixedRegionStaging
      ? `Parent staging · Provenance · ${JSON.stringify(local.draft.provenance.fixedRegionStaging)}`
      : 'Parent staging · Provenance · none',
    canReset: !local.acceptInFlight && local.draft.dirty,
    resetReason: local.acceptInFlight ? 'Accept is in progress' : local.draft.dirty ? null : 'Draft already matches the opening snapshot',
    canBuild: !local.acceptInFlight && buildReason == null,
    buildReason: local.acceptInFlight ? 'Accept is in progress' : buildReason,
    canAccept: !local.acceptInFlight && acceptReason == null && previewModel.acceptance.canAccept,
    acceptReason: local.acceptInFlight ? 'Accept is in progress' : acceptReason,
    warningRequired: previewModel.state === 'warning',
    warningConfirmed: local.warningConfirmation?.confirmed === true &&
      local.warningConfirmation.jobId === local.preview?.jobId &&
      local.warningConfirmation.recipeHash === local.preview?.recipeHash,
    filmstrip: {
      selectionKey,
      clipId: clip.id,
      clipLabel: clip.label ?? clip.name ?? clip.id,
      clips: clipEntries.map((item) => ({
        id: item.id,
        label: item.label ?? item.name ?? item.id,
        frameCount: Array.isArray(item.frames) ? item.frames.length : 0,
      })),
      fps,
      durationMs,
      selectedIndex: local.filmstrip.selectedIndex,
      playing: local.filmstrip.frames.length > 1 && local.filmstrip.playing,
      items: filmstripItems,
      summary: filmstripItems.length
        ? `${filmstripItems.length} frames; first sheet frame ${filmstripItems[0].frameIndex}`
        : '0 frames; no frame evidence',
    },
    qualityRows: qualityRowsFor(evidence),
    differenceDiagnosticText: differenceDiagnosticText(evidence?.differenceDiagnostics),
    aiActionRenderKey: JSON.stringify({
      assetId: aiAction.assetId,
      revisionId: aiAction.revisionId,
      selectedAction: aiAction.selectedAction,
      providerPresetId: aiAction.providerPresetId,
      imageSize: aiAction.imageSize,
      status: aiAction.status,
      message: aiAction.message,
      plan: aiAction.plan ?? null,
      job: aiAction.job ?? null,
      importResult: aiAction.importResult ?? null,
    }),
    diagnosticText: allDiagnostics.map((item) => item.message ?? item.code).join(' · ') || 'No preview diagnostics.',
    renderFrame: {
      ...renderFrame,
      frameSize,
      zoom: local.view.zoom,
      pan: local.view.pan,
      playing: false,
      overlayCommands: visibleOverlayCommands,
    },
  }
}

function setDisabled(control, disabled, reason = null, label = null) {
  control.disabled = Boolean(disabled)
  control.title = reason ?? ''
  if (label) control.setAttribute('aria-label', reason ? `${label}: unavailable (${reason})` : label)
}

function numericValue(control) {
  if (String(control.value).trim() === '') return Number.NaN
  return Number(control.value)
}

export function createRepairWorkbenchPanel({
  root,
  documentRef = document,
  lifecycle,
  createRenderer,
  onProjectAccepted,
  announce,
  createQualityGatePanel = createFrameRepairQualityGatePanel,
}) {
  const workbench = node(documentRef, 'section', 'editor-repair-workbench')
  workbench.dataset.recipeOpen = 'false'

  const header = node(documentRef, 'header', 'editor-repair-header')
  const assetName = labeledValue(documentRef, 'Asset')
  const revisionId = labeledValue(documentRef, 'Revision')
  const immutable = labeledValue(documentRef, 'Current')
  const previewState = labeledValue(documentRef, 'Preview')
  previewState.value.setAttribute('aria-live', 'polite')
  const recipeTrigger = node(documentRef, 'button', 'secondary editor-repair-recipe-trigger', 'Recipe')
  recipeTrigger.type = 'button'
  recipeTrigger.setAttribute('aria-controls', 'editor-repair-recipe')
  recipeTrigger.setAttribute('aria-expanded', 'false')
  header.append(assetName.wrap, revisionId.wrap, immutable.wrap, previewState.wrap, recipeTrigger)

  const canvasRegion = node(documentRef, 'section', 'editor-repair-canvas-region')
  const stateBanner = node(documentRef, 'div', 'editor-repair-state-banner')
  stateBanner.setAttribute('aria-live', 'polite')
  stateBanner.hidden = true
  const modes = node(documentRef, 'div', 'editor-repair-modes')
  for (const mode of ['before', 'after', 'split', 'difference', 'onion']) {
    const control = node(documentRef, 'button', 'secondary', capitalized(mode))
    control.type = 'button'
    control.dataset.repairMode = mode
    control.setAttribute('aria-pressed', 'false')
    modes.append(control)
  }
  const overlays = node(documentRef, 'div', 'editor-repair-overlays')
  for (const [overlay, label] of [['cuts', 'Cuts'], ['anchor', 'Anchor'], ['baseline', 'Baseline'], ['bbox', 'Bounds'], ['debug', 'Debug']]) {
    const control = node(documentRef, 'button', 'secondary', label)
    control.type = 'button'
    control.dataset.repairOverlay = overlay
    control.setAttribute('aria-pressed', 'false')
    overlays.append(control)
  }
  const zoomControls = node(documentRef, 'div', 'editor-repair-zoom-controls')
  const zoomOut = node(documentRef, 'button', 'secondary', 'Zoom out')
  const zoomReset = node(documentRef, 'button', 'secondary', 'Fit')
  const zoomIn = node(documentRef, 'button', 'secondary', 'Zoom in')
  const zoomValue = node(documentRef, 'output', 'editor-repair-zoom-value', '100%')
  for (const control of [zoomOut, zoomReset, zoomIn]) control.type = 'button'
  zoomControls.append(zoomOut, zoomReset, zoomIn, zoomValue)
  const differenceSidecar = node(documentRef, 'p', 'editor-repair-difference-sidecar')
  differenceSidecar.setAttribute('aria-live', 'polite')
  const canvas = node(documentRef, 'canvas', 'editor-repair-canvas')
  canvas.tabIndex = 0
  canvas.setAttribute('aria-label', 'Before and after Character Pack frame evidence')
  canvasRegion.append(stateBanner, modes, overlays, zoomControls, differenceSidecar, canvas)

  const recipe = node(documentRef, 'aside', 'editor-repair-recipe')
  recipe.id = 'editor-repair-recipe'
  recipe.setAttribute('aria-label', 'Processing Recipe')
  const recipeClose = node(documentRef, 'button', 'secondary editor-repair-recipe-close', 'Close Recipe')
  recipeClose.type = 'button'
  const recipeBody = node(documentRef, 'div', 'editor-repair-recipe-body')

  const geometry = node(documentRef, 'section', 'editor-repair-recipe-section')
  geometry.append(node(documentRef, 'h3', '', 'Geometry'))
  const sourceLayoutValue = node(documentRef, 'output', 'editor-repair-provenance-value')
  sourceLayoutValue.dataset.repairField = 'source-layout'
  const inputModeValue = node(documentRef, 'output', 'editor-repair-provenance-value')
  inputModeValue.dataset.repairField = 'input-mode'
  geometry.append(sourceLayoutValue, inputModeValue)

  function numberControl(label, pathValue, min, max, step = 1) {
    const wrap = node(documentRef, 'label', 'editor-repair-field')
    wrap.append(node(documentRef, 'span', '', label))
    const input = node(documentRef, 'input')
    input.type = 'number'
    input.min = String(min)
    input.max = String(max)
    input.step = String(step)
    input.dataset.repairPath = pathValue
    const origin = node(documentRef, 'small', 'editor-repair-origin')
    const reason = node(documentRef, 'small', 'editor-repair-control-reason')
    reason.id = `editor-repair-reason-${pathValue.replaceAll('.', '-')}`
    reason.hidden = true
    input.setAttribute('aria-describedby', reason.id)
    wrap.append(input, origin, reason)
    return { wrap, input, origin, reason }
  }

  const gridModeLabel = node(documentRef, 'label', 'editor-repair-field')
  gridModeLabel.append(node(documentRef, 'span', '', 'Grid mode'))
  const gridMode = node(documentRef, 'select')
  gridMode.dataset.repairControl = 'grid-mode'
  for (const [value, label] of [['auto', 'Auto'], ['manual', 'Manual']]) {
    const option = node(documentRef, 'option', '', label)
    option.value = value
    gridMode.append(option)
  }
  const gridOrigin = node(documentRef, 'small', 'editor-repair-origin', 'Default')
  const gridReason = node(documentRef, 'small', 'editor-repair-control-reason')
  gridReason.id = 'editor-repair-reason-grid-mode'
  gridReason.hidden = true
  gridMode.setAttribute('aria-describedby', gridReason.id)
  gridModeLabel.append(gridMode, gridOrigin, gridReason)
  geometry.append(gridModeLabel)
  const gridInputs = { columns: [], rows: [] }
  for (const [axis, label] of [['columns', 'X'], ['rows', 'Y']]) {
    const group = node(documentRef, 'div', 'editor-repair-grid-boundaries')
    group.setAttribute('aria-label', `${label} cut boundaries`)
    for (let index = 1; index <= 7; index += 1) {
      const field = numberControl(`${label}${index}`, `grid.${axis}.${index}`, 1, Number.MAX_SAFE_INTEGER)
      field.input.dataset.repairControl = axis === 'columns' ? 'grid-x' : 'grid-y'
      field.input.dataset.boundaryAxis = axis
      field.input.dataset.boundaryIndex = String(index)
      gridInputs[axis].push(field)
      group.append(field.wrap)
    }
    geometry.append(group)
  }
  const anchorX = numberControl('Anchor X', 'anchor_offset.x', -16, 16)
  const anchorY = numberControl('Anchor Y', 'anchor_offset.y', -16, 16)
  const frameDx = numberControl('Frame dx', 'selected_frame.dx', -16, 16)
  const frameDy = numberControl('Frame dy', 'selected_frame.dy', -16, 16)
  anchorX.input.dataset.repairControl = 'anchor-x'
  anchorY.input.dataset.repairControl = 'anchor-y'
  frameDx.input.dataset.repairControl = 'frame-dx'
  frameDy.input.dataset.repairControl = 'frame-dy'
  geometry.append(anchorX.wrap, anchorY.wrap, frameDx.wrap, frameDy.wrap)
  recipeBody.append(geometry)

  const recipeControls = new Map()
  const sections = new Map()
  for (const spec of REPAIR_RECIPE_CONTROL_SPECS) {
    if (!sections.has(spec.section)) {
      const section = node(documentRef, 'section', 'editor-repair-recipe-section')
      section.append(node(documentRef, 'h3', '', spec.section))
      sections.set(spec.section, section)
      recipeBody.append(section)
    }
    const label = node(documentRef, 'label', 'editor-repair-field')
    label.append(node(documentRef, 'span', '', spec.label))
    const control = node(documentRef, spec.type === 'select' || spec.type === 'multiple' ? 'select' : 'input')
    control.dataset.repairControl = spec.control
    control.dataset.repairPath = spec.path
    if (spec.type === 'checkbox') control.type = 'checkbox'
    if (spec.type === 'number') {
      control.type = 'number'
      control.min = String(spec.min)
      control.max = String(spec.max)
      control.step = String(spec.step)
    }
    if (spec.type === 'multiple') control.multiple = true
    for (const value of spec.options ?? []) {
      const option = node(documentRef, 'option', '', value)
      option.value = value
      control.append(option)
    }
    const origin = node(documentRef, 'small', 'editor-repair-origin')
    const reason = node(documentRef, 'small', 'editor-repair-control-reason')
    reason.id = `editor-repair-reason-${spec.control}`
    reason.hidden = true
    control.setAttribute('aria-describedby', reason.id)
    label.append(control, origin, reason)
    sections.get(spec.section).append(label)
    recipeControls.set(spec.path, { spec, control, origin, reason })
  }

  const forcedEvidence = node(documentRef, 'section', 'editor-repair-recipe-section')
  forcedEvidence.append(node(documentRef, 'h3', '', 'Output evidence'))
  const styleEnabled = node(documentRef, 'output')
  styleEnabled.dataset.repairControl = 'style-enabled'
  const outputSizes = node(documentRef, 'output')
  outputSizes.dataset.repairControl = 'output-sizes'
  const fixedStaging = node(documentRef, 'output')
  fixedStaging.dataset.repairEvidence = 'fixed-staging'
  const pixelGrid = node(documentRef, 'button', 'secondary', 'Pixel Grid Refinement · Coming later')
  pixelGrid.type = 'button'
  pixelGrid.disabled = true
  pixelGrid.title = 'This processing path does not expose Pixel Grid Refinement'
  pixelGrid.setAttribute('aria-label', `Pixel Grid Refinement: Coming later (${pixelGrid.title})`)
  forcedEvidence.append(styleEnabled, outputSizes, fixedStaging, pixelGrid)
  recipeBody.append(forcedEvidence)

  const aiAction = node(documentRef, 'details', 'editor-repair-ai-action')
  const aiActionBody = node(documentRef, 'div', 'editor-repair-ai-action-body')
  aiAction.append(node(documentRef, 'summary', '', 'AI Action Repair'), aiActionBody)
  const frameRepairPanel = createFrameRepairPanel({
    documentRef,
    onAction: handleFrameRepairAction,
  })
  frameRepairPanel.element.hidden = true
  frameRepairPanel.element.inert = true
  recipe.append(recipeClose, recipeBody, aiAction, frameRepairPanel.element)

  const filmstrip = node(documentRef, 'section', 'editor-repair-filmstrip')
  const filmstripToolbar = node(documentRef, 'div', 'editor-repair-filmstrip-toolbar')
  const filmstripClipLabel = node(documentRef, 'label', 'editor-repair-filmstrip-clip-label')
  filmstripClipLabel.append(node(documentRef, 'span', '', 'Clip'))
  const filmstripClip = node(documentRef, 'select', 'editor-repair-filmstrip-clip')
  filmstripClip.dataset.repairControl = 'filmstrip-clip'
  filmstripClipLabel.append(filmstripClip)
  const filmstripFirst = node(documentRef, 'button', 'secondary editor-repair-filmstrip-first', 'First')
  const filmstripPlay = node(documentRef, 'button', 'secondary editor-repair-filmstrip-play', 'Play')
  const filmstripLast = node(documentRef, 'button', 'secondary editor-repair-filmstrip-last', 'Last')
  const frameRepairTrigger = node(documentRef, 'button', 'secondary editor-repair-frame-trigger', 'Repair Frame')
  const qualityGateTrigger = node(documentRef, 'button', 'secondary editor-repair-quality-gate-trigger', 'Quality Gate')
  const filmstripMeta = node(documentRef, 'output', 'editor-repair-filmstrip-meta')
  for (const control of [filmstripFirst, filmstripPlay, filmstripLast, frameRepairTrigger, qualityGateTrigger]) control.type = 'button'
  frameRepairTrigger.setAttribute('aria-pressed', 'false')
  qualityGateTrigger.setAttribute('aria-pressed', 'false')
  qualityGateTrigger.hidden = true
  qualityGateTrigger.disabled = true
  filmstripToolbar.append(filmstripClipLabel, filmstripFirst, filmstripPlay, filmstripLast, frameRepairTrigger, qualityGateTrigger, filmstripMeta)
  const filmstripFrames = node(documentRef, 'div', 'editor-repair-filmstrip-frames')
  filmstripFrames.tabIndex = 0
  filmstripFrames.setAttribute('role', 'listbox')
  filmstripFrames.setAttribute('aria-label', 'Selected clip frames')
  filmstrip.append(filmstripToolbar, filmstripFrames)

  const quality = node(documentRef, 'section', 'editor-repair-quality')
  const qualityMetrics = node(documentRef, 'dl', 'editor-repair-quality-metrics')
  const diagnostics = node(documentRef, 'div', 'editor-repair-diagnostics')
  diagnostics.setAttribute('aria-live', 'polite')
  const warningLabel = node(documentRef, 'label', 'editor-repair-warning-confirmation')
  const warningConfirmation = node(documentRef, 'input')
  warningConfirmation.type = 'checkbox'
  warningConfirmation.dataset.repairControl = 'warning-confirmation'
  warningLabel.append(warningConfirmation, node(documentRef, 'span', '', 'I reviewed this warning preview'))
  warningLabel.hidden = true
  const reset = node(documentRef, 'button', 'secondary', 'Reset draft')
  const build = node(documentRef, 'button', '', 'Build Preview')
  const accept = node(documentRef, 'button', '', 'Accept as revision')
  const discard = node(documentRef, 'button', 'secondary', 'Discard session')
  for (const control of [reset, build, accept, discard]) control.type = 'button'
  quality.append(qualityMetrics, diagnostics, warningLabel, reset, build, accept, discard)

  const qualityGatePanel = createQualityGatePanel({
    documentRef,
    onAction: handleQualityGateAction,
    announce,
  })
  qualityGatePanel.element.hidden = true
  qualityGatePanel.element.inert = true

  const qualityAuthoringActions = node(documentRef, 'div', 'editor-frame-repair-quality-authoring-actions')
  const saveQualityCase = node(documentRef, 'button', '', 'Save case definition')
  const cancelQualityCase = node(documentRef, 'button', 'secondary', 'Cancel case authoring')
  saveQualityCase.type = cancelQualityCase.type = 'button'
  qualityAuthoringActions.append(saveQualityCase, cancelQualityCase)
  qualityAuthoringActions.hidden = true
  qualityAuthoringActions.inert = true
  recipe.append(qualityAuthoringActions)

  const recipeBackdrop = node(documentRef, 'button', 'editor-repair-recipe-backdrop', 'Close Recipe')
  recipeBackdrop.type = 'button'
  recipeBackdrop.hidden = true
  recipeBackdrop.setAttribute('aria-label', 'Close Processing Recipe')
  workbench.append(header, canvasRegion, recipe, filmstrip, quality, qualityGatePanel.element, recipeBackdrop)
  root.replaceChildren(workbench)

  const renderer = createRenderer(canvas)
  let context = null
  let lastScrolledFrame = null
  let lastAiActionRenderKey = null
  let lastAnnouncedPreviewState = null
  let panPointer = null
  let frameRepairPointerId = null
  let panelAcceptInFlight = false
  let narrowQuery = null
  let qualityGateRuntime = null
  let qualityGateOpen = false
  let qualityGateAuthoring = false
  let qualityGateAuthoringPayload = null
  let qualityWorkspaceHome = null
  let lastWorkbenchView = null
  let lastQualityGateView = null
  let destroyed = false
  const listeners = []
  const listen = (target, type, handler) => {
    target.addEventListener(type, handler)
    listeners.push(() => target.removeEventListener(type, handler))
  }

  function currentView() {
    return context?.viewModel()
  }

  const standardWorkspaceRegions = [header, recipe, filmstrip, quality, recipeBackdrop]

  function nextSiblingOf(parent, child) {
    const children = [...(parent?.children ?? [])]
    const index = children.indexOf(child)
    return index >= 0 ? children[index + 1] ?? null : null
  }

  function snapshotQualityWorkspaceHome() {
    if (qualityWorkspaceHome || !canvasRegion.parentNode) return
    qualityWorkspaceHome = {
      canvasParent: canvasRegion.parentNode,
      canvasNextSibling: nextSiblingOf(canvasRegion.parentNode, canvasRegion),
      canvasInert: canvasRegion.inert,
      recipeOpen: workbench.dataset.recipeOpen,
      regions: standardWorkspaceRegions.map((element) => ({
        element,
        hidden: element.hidden,
        inert: element.inert,
      })),
    }
  }

  function restoreQualityWorkspaceHome({ release = false } = {}) {
    const home = qualityWorkspaceHome
    if (home?.canvasParent) {
      const reference = home.canvasNextSibling?.parentNode === home.canvasParent
        ? home.canvasNextSibling
        : null
      home.canvasParent.insertBefore(canvasRegion, reference)
      canvasRegion.inert = home.canvasInert
      workbench.dataset.recipeOpen = home.recipeOpen
      for (const entry of home.regions) {
        entry.element.hidden = entry.hidden
        entry.element.inert = entry.inert
      }
    }
    delete workbench.dataset.qualityGateWorkspace
    qualityGatePanel.element.hidden = true
    qualityGatePanel.element.inert = true
    qualityGateTrigger.setAttribute('aria-pressed', 'false')
    if (release) qualityWorkspaceHome = null
  }

  function qualityGateRuntimeView() {
    if (!qualityGateRuntime || typeof qualityGateRuntime.getView !== 'function') return null
    return qualityGateRuntime.getView()
  }

  function blindPresentationFrom(view) {
    const value = view?.blindPresentation ?? view?.ui?.blindPresentation ?? view?.frameRepair?.blindPresentation
    if (!value) return null
    if (value === true) return { a: 'before', b: 'after' }
    if (typeof value !== 'object' || value.revealed === true || value.active === false || value.mode === 'revealed') return null
    const a = value.a === 'after' ? 'after' : 'before'
    const b = value.b === 'before' ? 'before' : 'after'
    if (a === b) return { ...value, a: 'before', b: 'after' }
    return { ...value, a, b }
  }

  function restoreComparisonPresentation() {
    const viewModel = lastWorkbenchView
    if (!viewModel) return
    for (const control of modes.querySelectorAll('[data-repair-mode]')) {
      const mode = control.dataset.repairMode
      const availability = viewModel.modeAvailability?.[mode] ?? { enabled: false, reason: 'mode_unavailable' }
      control.hidden = false
      control.inert = false
      control.textContent = capitalized(mode)
      delete control.dataset.qualityGateUnderlyingMode
      setDisabled(control, !availability.enabled, availability.reason, capitalized(mode))
      control.setAttribute('aria-pressed', String(viewModel.mode === mode))
    }
    differenceSidecar.hidden = false
    differenceSidecar.inert = false
    canvas.setAttribute('aria-label', 'Before and after Character Pack frame evidence')
    const state = renderStateBanner(viewModel)
    if (viewModel.frameRepair?.active === true) {
      stateBanner.dataset.tone = viewModel.frameRepair.error
        ? 'blocking'
        : viewModel.frameRepair.uiState === 'warning' ? 'warning' : 'neutral'
      stateBanner.textContent = viewModel.frameRepair.message ?? ''
      stateBanner.hidden = !stateBanner.textContent
    }
    return state
  }

  function applyBlindPresentation(qualityView) {
    const presentation = blindPresentationFrom(qualityView)
    if (!presentation) {
      restoreComparisonPresentation()
      return
    }
    const viewModel = lastWorkbenchView
    const slots = { before: ['A', presentation.a], after: ['B', presentation.b] }
    for (const control of modes.querySelectorAll('[data-repair-mode]')) {
      const mode = control.dataset.repairMode
      if (!(mode in slots)) {
        control.hidden = true
        control.inert = true
        setDisabled(control, true, 'Reveal the blind mapping to use this comparison mode', capitalized(mode))
        continue
      }
      const [label, underlyingMode] = slots[mode]
      const availability = viewModel?.modeAvailability?.[underlyingMode] ?? { enabled: false, reason: 'mode_unavailable' }
      control.hidden = false
      control.inert = false
      control.textContent = label
      control.dataset.qualityGateUnderlyingMode = underlyingMode
      setDisabled(control, !availability.enabled, availability.reason, `View ${label}`)
      control.setAttribute('aria-pressed', String(viewModel?.mode === underlyingMode))
    }
    differenceSidecar.hidden = true
    differenceSidecar.inert = true
    canvas.setAttribute(
      'aria-label',
      presentation.canvasLabel ?? 'Blind A and B Character Pack frame comparison; the mapping is hidden until reveal',
    )
    stateBanner.dataset.tone = presentation.tone ?? 'neutral'
    stateBanner.textContent = presentation.stateText ?? 'Blind comparison ready. Choose A or B before reveal.'
    stateBanner.hidden = false
  }

  function renderQualityGateRuntime() {
    if (!qualityGateOpen || qualityGateAuthoring || !qualityGateRuntime) return
    try {
      lastQualityGateView = qualityGateRuntimeView()
      qualityGatePanel.render(lastQualityGateView)
      applyBlindPresentation(lastQualityGateView)
    } catch {
      closeQualityGate('error')
      announce?.('Quality Gate closed because its review view could not be rendered.')
    }
  }

  function enterQualityWorkspace({ focus = false } = {}) {
    if (!qualityGateOpen || !qualityGateRuntime || !qualityWorkspaceHome) return false
    qualityGateAuthoring = false
    workbench.dataset.qualityGateWorkspace = 'true'
    for (const element of standardWorkspaceRegions) {
      element.hidden = true
      element.inert = true
    }
    qualityGatePanel.element.hidden = false
    qualityGatePanel.element.inert = false
    qualityGatePanel.canvasSlot.insertBefore(canvasRegion, null)
    canvasRegion.inert = false
    qualityGateTrigger.setAttribute('aria-pressed', 'true')
    renderQualityGateRuntime()
    if (focus) qualityGatePanel.focusPrimary?.()
    return true
  }

  function beginQualityGateAuthoring() {
    if (!qualityGateOpen || !qualityWorkspaceHome) return false
    qualityGateAuthoring = true
    restoreComparisonPresentation()
    restoreQualityWorkspaceHome()
    return true
  }

  async function handleQualityGateAction(type, payload) {
    if (destroyed || !qualityGateOpen || !qualityGateRuntime || typeof qualityGateRuntime.handleAction !== 'function') return null
    if (type === 'exit') {
      closeQualityGate('exit')
      try {
        return await qualityGateRuntime.handleAction(type, payload)
      } catch {
        return null
      }
    }
    if (type === 'author_case') {
      if (!beginQualityGateAuthoring()) return null
      qualityGateAuthoringPayload = payload && typeof payload === 'object' ? { ...payload } : null
      try {
        const result = await qualityGateRuntime.handleAction(type, payload)
        if (result === false) {
          qualityGateAuthoringPayload = null
          enterQualityWorkspace()
        }
        return result
      } catch {
        qualityGateAuthoringPayload = null
        closeQualityGate('error')
        return null
      }
    }
    if (type === 'save_case' || type === 'cancel_authoring') {
      if (!qualityGateAuthoring) return null
      try {
        const actionPayload = type === 'save_case' && payload == null
          ? qualityGateAuthoringPayload
          : payload
        const result = await qualityGateRuntime.handleAction(type, actionPayload)
        if (result === false || result == null) {
          if (type === 'save_case') announce?.('The case definition is incomplete and was not saved.')
          return result
        }
        qualityGateAuthoringPayload = null
        enterQualityWorkspace({ focus: true })
        return result
      } catch {
        qualityGateAuthoringPayload = null
        closeQualityGate('error')
        return null
      }
    }
    try {
      const result = await qualityGateRuntime.handleAction(type, payload)
      renderQualityGateRuntime()
      return result
    } catch {
      closeQualityGate('error')
      return null
    }
  }

  function handleFrameRepairAction(type, payload) {
    if (!context) return
    if (qualityGateAuthoring) {
      if (type === 'close') void handleQualityGateAction('cancel_authoring')
      if (!['set_mask_mode', 'set_instruction', 'select_edit', 'update_edit', 'delete_edit', 'undo'].includes(type)) return
    }
    if (type === 'close') context.closeFrameRepair('panel_switch')
    if (type === 'set_mask_mode') context.setFrameRepairMaskMode(payload)
    if (type === 'set_instruction') context.setFrameRepairInstruction(payload)
    if (type === 'set_provider') context.setFrameRepairProvider(payload)
    if (type === 'set_image_size') context.setFrameRepairImageSize(payload)
    if (type === 'select_edit') context.selectFrameRepairEdit(payload)
    if (type === 'update_edit') context.updateFrameRepairEdit(payload)
    if (type === 'delete_edit') context.deleteFrameRepairEdit()
    if (type === 'undo') context.undoFrameRepairEdit()
    if (type === 'review') void context.reviewFrameRepairCall()
    if (type === 'generate') void context.generateFrameRepairCandidate()
    if (type === 'recover') void context.recoverFrameRepairOperation()
    if (type === 'accept') void context.acceptFrameRepairCandidate()
    if (type === 'discard') context.discardFrameRepairCandidate()
    if (type === 'confirm_warning') context.confirmFrameRepairWarning(payload)
  }

  function recipeFocusable() {
    return [...recipe.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex="0"]')]
      .filter((entry) => {
        let cursor = entry
        while (cursor && cursor !== recipe) {
          if (cursor.hidden || cursor.inert) return false
          cursor = cursor.parentNode
        }
        const details = entry.closest?.('details')
        return !details || details.open || entry.tagName === 'SUMMARY'
      })
  }

  function isNarrow() {
    return documentRef.defaultView?.matchMedia?.('(max-width: 760px)').matches === true
  }

  function closeRecipeDrawer({ restoreFocus = true } = {}) {
    const narrow = isNarrow()
    workbench.dataset.recipeOpen = 'false'
    recipeTrigger.setAttribute('aria-expanded', 'false')
    recipe.removeAttribute('role')
    recipe.removeAttribute('aria-modal')
    if (narrow) recipe.setAttribute('aria-hidden', 'true')
    else recipe.removeAttribute('aria-hidden')
    recipe.inert = narrow
    recipeBackdrop.hidden = true
    canvasRegion.inert = false
    filmstrip.inert = false
    quality.inert = currentView()?.frameRepair?.active === true
    if (restoreFocus) recipeTrigger.focus()
  }

  function openRecipeDrawer() {
    if (!isNarrow()) return
    workbench.dataset.recipeOpen = 'true'
    recipeTrigger.setAttribute('aria-expanded', 'true')
    recipe.setAttribute('role', 'dialog')
    recipe.setAttribute('aria-modal', 'true')
    recipe.removeAttribute('aria-hidden')
    recipe.inert = false
    recipeBackdrop.hidden = false
    canvasRegion.inert = true
    filmstrip.inert = true
    quality.inert = true
    ;(recipeFocusable()[0] ?? recipe).focus()
  }

  function syncNarrowDrawer() {
    if (qualityGateOpen && !qualityGateAuthoring) return
    if (!isNarrow()) closeRecipeDrawer({ restoreFocus: false })
    else if (workbench.dataset.recipeOpen !== 'true') closeRecipeDrawer({ restoreFocus: false })
  }

  listen(recipeTrigger, 'click', openRecipeDrawer)
  listen(recipeClose, 'click', () => closeRecipeDrawer())
  listen(recipeBackdrop, 'click', () => closeRecipeDrawer())
  listen(recipe, 'keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeRecipeDrawer()
      return
    }
    if (event.key !== 'Tab' || workbench.dataset.recipeOpen !== 'true') return
    const focusable = recipeFocusable()
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && documentRef.activeElement === first) { event.preventDefault(); last?.focus() }
    if (!event.shiftKey && documentRef.activeElement === last) { event.preventDefault(); first?.focus() }
  })
  narrowQuery = documentRef.defaultView?.matchMedia?.('(max-width: 760px)') ?? null
  const narrowChange = () => syncNarrowDrawer()
  narrowQuery?.addEventListener?.('change', narrowChange)
  if (narrowQuery?.removeEventListener) listeners.push(() => narrowQuery.removeEventListener('change', narrowChange))

  listen(modes, 'click', (event) => {
    const control = event.target.closest?.('[data-repair-mode]')
    const presentation = qualityGateOpen
      ? blindPresentationFrom(lastQualityGateView ?? qualityGateRuntimeView())
      : null
    const slot = control?.dataset.repairMode
    const blindSlot = slot === 'before' ? 'a' : slot === 'after' ? 'b' : null
    const mode = presentation && blindSlot
      ? presentation[blindSlot]
      : control?.dataset.qualityGateUnderlyingMode ?? slot
    if (mode && !control.disabled) context?.setView({ mode })
  })
  listen(overlays, 'click', (event) => {
    const control = event.target.closest?.('[data-repair-overlay]')
    const overlay = control?.dataset.repairOverlay
    if (!overlay || control.disabled || !context) return
    const viewModel = currentView()
    context.setView({ overlays: { ...viewModel.overlays, [overlay]: !viewModel.overlays[overlay] } })
  })
  const changeZoom = (factor) => {
    if (!context) return
    const viewModel = currentView()
    context.setView({ zoom: Math.max(0.25, Math.min(4, viewModel.zoom * factor)) })
  }
  listen(zoomOut, 'click', () => changeZoom(0.5))
  listen(zoomIn, 'click', () => changeZoom(2))
  listen(zoomReset, 'click', () => context?.setView({ zoom: 1, pan: { x: 0, y: 0 } }))
  listen(canvas, 'wheel', (event) => { event.preventDefault(); changeZoom(event.deltaY > 0 ? 0.5 : 2) })
  const framePointerPayload = (event, viewModel) => ({
    clientX: event.clientX,
    clientY: event.clientY,
    pointerId: event.pointerId,
    canvasRect: canvas.getBoundingClientRect(),
    zoom: viewModel.zoom,
    pan: viewModel.pan,
  })
  listen(canvas, 'pointerdown', (event) => {
    if (!context) return
    const viewModel = currentView()
    if (viewModel?.frameRepair?.active) {
      event.preventDefault()
      panPointer = null
      frameRepairPointerId = event.pointerId
      canvas.setPointerCapture?.(event.pointerId)
      context.handleFrameRepairPointer('down', framePointerPayload(event, viewModel))
      return
    }
    panPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, pan: currentView().pan }
    canvas.setPointerCapture?.(event.pointerId)
  })
  listen(canvas, 'pointermove', (event) => {
    const viewModel = currentView()
    if (viewModel?.frameRepair?.active && frameRepairPointerId === event.pointerId) {
      event.preventDefault()
      context?.handleFrameRepairPointer('move', framePointerPayload(event, viewModel))
      return
    }
    if (!panPointer || panPointer.id !== event.pointerId) return
    context?.setView({ pan: { x: panPointer.pan.x + event.clientX - panPointer.x, y: panPointer.pan.y + event.clientY - panPointer.y } })
  })
  const endPointer = (type, event) => {
    const viewModel = currentView()
    if (viewModel?.frameRepair?.active && frameRepairPointerId === event.pointerId) {
      event.preventDefault()
      context?.handleFrameRepairPointer(type, framePointerPayload(event, viewModel))
      frameRepairPointerId = null
      canvas.releasePointerCapture?.(event.pointerId)
      return
    }
    if (panPointer?.id === event.pointerId) panPointer = null
  }
  listen(canvas, 'pointerup', (event) => endPointer('up', event))
  listen(canvas, 'pointercancel', (event) => endPointer('cancel', event))
  listen(reset, 'click', () => { if (!reset.disabled) context?.resetDraft() })
  listen(build, 'click', () => { if (!build.disabled) context?.buildPreview() })
  listen(accept, 'click', async () => {
    if (accept.disabled || panelAcceptInFlight) return
    panelAcceptInFlight = true
    try {
      const result = await context?.acceptPreview()
      if (result) onProjectAccepted(result)
    } finally {
      panelAcceptInFlight = false
    }
  })
  listen(discard, 'click', () => context?.discard())
  listen(warningConfirmation, 'change', () => context?.confirmWarning(warningConfirmation.checked))
  listen(filmstripFirst, 'click', () => { if (!filmstripFirst.disabled) context?.handleFilmstripAction('first') })
  listen(filmstripPlay, 'click', () => { if (!filmstripPlay.disabled) context?.handleFilmstripAction('toggle_play') })
  listen(filmstripLast, 'click', () => { if (!filmstripLast.disabled) context?.handleFilmstripAction('last') })
  listen(frameRepairTrigger, 'click', () => {
    if (frameRepairTrigger.disabled || !context) return
    if (currentView()?.frameRepair?.active) {
      context.closeFrameRepair('panel_switch')
      return
    }
    if (context.enterFrameRepair() && isNarrow()) {
      openRecipeDrawer()
      frameRepairPanel.focusFirst()
    }
  })
  listen(qualityGateTrigger, 'click', () => {
    if (!qualityGateTrigger.disabled) openQualityGate({ focus: true })
  })
  listen(saveQualityCase, 'click', () => {
    if (!saveQualityCase.disabled) void handleQualityGateAction('save_case')
  })
  listen(cancelQualityCase, 'click', () => {
    if (!cancelQualityCase.disabled) void handleQualityGateAction('cancel_authoring')
  })
  listen(filmstripClip, 'change', () => { if (!filmstripClip.disabled) context?.selectClip(filmstripClip.value) })
  listen(filmstripFrames, 'click', (event) => {
    const option = event.target.closest?.('[data-frame-option]')
    if (option) context?.selectFilmstripFrame(Number(option.dataset.frameOption))
  })
  listen(filmstripFrames, 'keydown', (event) => {
    if (event.target !== filmstripFrames && event.target?.dataset?.frameOption == null) return
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', ' '].includes(event.key)) return
    if (event.key === ' ' && (currentView()?.filmstrip.items.length ?? 0) < 2) return
    event.preventDefault()
    event.stopPropagation?.()
    context?.handleFilmstripKey(event.key)
    filmstripFrames.querySelector('[tabindex="0"]')?.focus()
  })

  function manualOverridesFromInputs(viewModel) {
    return {
      columns: [0, ...gridInputs.columns.map((field) => numericValue(field.input)), viewModel.sourceSize.width],
      rows: [0, ...gridInputs.rows.map((field) => numericValue(field.input)), viewModel.sourceSize.height],
    }
  }
  listen(gridMode, 'change', () => {
    if (gridMode.disabled) return
    context?.patchDraft({ path: 'grid.manual_overrides', value: gridMode.value === 'manual' ? manualOverridesFromInputs(currentView()) : null })
  })
  for (const field of [...gridInputs.columns, ...gridInputs.rows]) {
    listen(field.input, 'input', () => {
      if (!field.input.disabled) context?.patchDraft({ path: 'grid.manual_overrides', value: manualOverridesFromInputs(currentView()) })
    })
  }
  for (const field of [anchorX, anchorY]) {
    listen(field.input, 'input', () => context?.patchDraft({ path: field.input.dataset.repairPath, value: numericValue(field.input) }))
  }
  for (const [field, component] of [[frameDx, 'dx'], [frameDy, 'dy']]) {
    listen(field.input, 'input', () => {
      const frameIndex = currentView()?.frameIndex
      if (Number.isInteger(frameIndex)) context?.patchDraft({ path: `frame_adjustments.${frameIndex}.${component}`, value: numericValue(field.input) })
    })
  }
  for (const { spec, control } of recipeControls.values()) {
    listen(control, spec.type === 'number' ? 'input' : 'change', () => {
      if (control.disabled) return
      const value = spec.type === 'checkbox'
        ? control.checked
        : spec.type === 'number'
          ? numericValue(control)
          : spec.type === 'multiple'
            ? [...control.selectedOptions].map((option) => option.value)
            : control.value
      context?.patchDraft({ path: spec.path, value })
    })
  }

  function renderGeometry(viewModel) {
    const manual = viewModel.recipe.grid.manual_overrides
    sourceLayoutValue.value = `${viewModel.recipe.source.source_layout} · Provenance`
    sourceLayoutValue.textContent = `Source layout · ${sourceLayoutValue.value}`
    inputModeValue.value = `${viewModel.inputMode} · Provenance`
    inputModeValue.textContent = `Input mode · ${inputModeValue.value}`
    gridMode.value = manual ? 'manual' : 'auto'
    setDisabled(gridMode, !viewModel.manualGrid.enabled, viewModel.manualGrid.reason, 'Grid mode')
    gridReason.textContent = viewModel.manualGrid.reason ?? ''
    gridReason.hidden = !viewModel.manualGrid.reason
    gridOrigin.textContent = capitalized(viewModel.fieldOrigins['grid.manual_overrides'] ?? 'default')
    const boundaryReason = !viewModel.manualGrid.enabled
      ? viewModel.manualGrid.reason
      : !manual
        ? 'Switch Grid mode to Manual to edit boundaries'
        : null
    for (const axis of ['columns', 'rows']) {
      gridInputs[axis].forEach((field, offset) => {
        const source = manual?.[axis] ?? viewModel.autoGrid[axis]
        field.input.max = String(axis === 'columns' ? viewModel.sourceSize.width - 1 : viewModel.sourceSize.height - 1)
        field.input.value = String(source?.[offset + 1] ?? '')
        setDisabled(field.input, !manual || !viewModel.manualGrid.enabled, boundaryReason, `${axis} boundary ${offset + 1}`)
        field.reason.textContent = boundaryReason ?? ''
        field.reason.hidden = !boundaryReason
        field.input.setAttribute('aria-invalid', String(viewModel.invalidPaths.has('grid.manual_overrides')))
        field.origin.textContent = capitalized(viewModel.fieldOrigins['grid.manual_overrides'] ?? 'default')
      })
    }
    anchorX.input.value = String(viewModel.recipe.anchor_offset.x)
    anchorY.input.value = String(viewModel.recipe.anchor_offset.y)
    frameDx.input.value = String(viewModel.selectedFrameAdjustment.dx)
    frameDy.input.value = String(viewModel.selectedFrameAdjustment.dy)
    for (const field of [frameDx, frameDy]) {
      const reason = viewModel.hasSelectedFrame ? null : 'Select a real clip frame to edit its offset'
      setDisabled(field.input, !viewModel.hasSelectedFrame, reason, field.input.dataset.repairControl)
      field.reason.textContent = reason ?? ''
      field.reason.hidden = !reason
    }
    anchorX.input.setAttribute('aria-invalid', String(viewModel.invalidPaths.has('anchor_offset.x')))
    anchorY.input.setAttribute('aria-invalid', String(viewModel.invalidPaths.has('anchor_offset.y')))
    frameDx.input.setAttribute('aria-invalid', String(viewModel.invalidPaths.has('frame_adjustments')))
    frameDy.input.setAttribute('aria-invalid', String(viewModel.invalidPaths.has('frame_adjustments')))
    anchorX.origin.textContent = capitalized(viewModel.fieldOrigins['anchor_offset.x'] ?? 'default')
    anchorY.origin.textContent = capitalized(viewModel.fieldOrigins['anchor_offset.y'] ?? 'default')
    frameDx.origin.textContent = capitalized(viewModel.fieldOrigins.frame_adjustments ?? 'default')
    frameDy.origin.textContent = frameDx.origin.textContent
  }

  function renderRecipeControls(viewModel) {
    for (const [pathValue, entry] of recipeControls) {
      if (entry.spec.type === 'multiple') {
        const signature = JSON.stringify(viewModel.profileAnimations)
        if (entry.control.dataset.signature !== signature) {
          entry.control.dataset.signature = signature
          entry.control.replaceChildren(...viewModel.profileAnimations.map((animation) => {
            const option = node(documentRef, 'option', '', animation.label)
            option.value = animation.id
            return option
          }))
        }
        const selected = new Set(getPlainPath(viewModel.recipe, pathValue))
        for (const option of entry.control.options) option.selected = selected.has(option.value)
      } else if (entry.spec.type === 'checkbox') {
        entry.control.checked = getPlainPath(viewModel.recipe, pathValue) === true
      } else {
        entry.control.value = String(getPlainPath(viewModel.recipe, pathValue) ?? '')
      }
      const availability = viewModel.controlAvailability[pathValue] ?? { enabled: true, reason: null }
      setDisabled(entry.control, !availability.enabled, availability.reason, entry.spec.label)
      entry.reason.textContent = availability.reason ?? ''
      entry.reason.hidden = !availability.reason
      entry.control.setAttribute('aria-invalid', String(viewModel.invalidPaths.has(pathValue)))
      entry.origin.textContent = capitalized(viewModel.fieldOrigins[pathValue] ?? 'default')
    }
    const dualMatte = recipeControls.get('background.mode').control.querySelector('option[value="dual_matte"]')
    if (dualMatte) {
      dualMatte.disabled = !viewModel.dualMatte.enabled
      dualMatte.title = viewModel.dualMatte.reason ?? ''
    }
    const backgroundReason = recipeControls.get('background.mode').reason
    backgroundReason.textContent = viewModel.dualMatte.enabled ? '' : `dual_matte: ${viewModel.dualMatte.reason}`
    backgroundReason.hidden = viewModel.dualMatte.enabled
    styleEnabled.value = 'Style report enabled · Forced'
    styleEnabled.textContent = styleEnabled.value
    outputSizes.value = `${viewModel.recipe.outputs.frame_sizes.join(', ')} · Forced`
    outputSizes.textContent = outputSizes.value
    fixedStaging.value = viewModel.fixedStagingProvenance
    fixedStaging.textContent = viewModel.fixedStagingProvenance
  }

  const filmstripOptions = new Map()
  const renderedThumbnails = new Set()
  function drawFilmstripThumbnail(canvasNode, item, cacheKey) {
    if (!item.available || !item.rect || renderedThumbnails.has(cacheKey)) return
    const ctx = canvasNode.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, canvasNode.width, canvasNode.height)
    ctx.drawImage(item.source, item.rect.sx, item.rect.sy, item.rect.sw, item.rect.sh, 0, 0, canvasNode.width, canvasNode.height)
    renderedThumbnails.add(cacheKey)
  }

  function renderFilmstrip(viewModel) {
    const model = viewModel.filmstrip
    const frameActive = viewModel.frameRepair?.active === true
    const eligibility = viewModel.frameRepairEligibility ?? { enabled: false, reason: 'Frame Repair is unavailable' }
    const qualityGateEligible = eligibility.enabled === true && qualityGateRuntime !== null
    setDisabled(
      frameRepairTrigger,
      !frameActive && !eligibility.enabled,
      frameActive ? null : eligibility.reason,
      frameActive ? 'Close Frame Repair' : 'Repair Frame',
    )
    frameRepairTrigger.setAttribute('aria-pressed', String(frameActive))
    qualityGateTrigger.hidden = !qualityGateEligible
    setDisabled(
      qualityGateTrigger,
      !qualityGateEligible || frameActive,
      !qualityGateEligible ? eligibility.reason ?? 'Quality Gate runtime is unavailable' : frameActive ? 'Close Frame Repair before opening Quality Gate' : null,
      'Quality Gate',
    )
    qualityGateTrigger.setAttribute('aria-pressed', String(qualityGateOpen && !qualityGateAuthoring))
    const clipSignature = JSON.stringify(model.clips)
    if (filmstripClip.dataset.signature !== clipSignature) {
      filmstripClip.dataset.signature = clipSignature
      filmstripClip.replaceChildren(...model.clips.map((clip) => {
        const option = node(documentRef, 'option')
        option.value = clip.id
        option.textContent = `${clip.label} · ${clip.frameCount}`
        option.title = clip.label
        option.setAttribute('aria-label', `${clip.label}, ${clip.frameCount} frames`)
        return option
      }))
    }
    setDisabled(filmstripClip, model.clips.length === 0, model.clips.length ? null : 'No real clips are available', 'Clip')
    filmstripClip.value = model.clipId
    setDisabled(filmstripFirst, !model.items.length || model.selectedIndex === 0, !model.items.length ? 'The selected clip has no frames' : model.selectedIndex === 0 ? 'Already at the first frame' : null, 'First frame')
    setDisabled(filmstripLast, !model.items.length || model.selectedIndex === model.items.length - 1, !model.items.length ? 'The selected clip has no frames' : model.selectedIndex === model.items.length - 1 ? 'Already at the last frame' : null, 'Last frame')
    const playbackReason = model.items.length < 2
      ? 'Playback requires at least two frames'
      : model.fps <= 0
        ? 'Playback requires a valid fps value'
        : null
    setDisabled(filmstripPlay, playbackReason != null, playbackReason, model.playing ? 'Pause' : 'Play')
    filmstripPlay.textContent = model.playing ? 'Pause' : 'Play'
    filmstripPlay.setAttribute('aria-pressed', String(model.playing))
    const currentPosition = model.items.length ? model.selectedIndex + 1 : 0
    const fpsLabel = model.fps > 0 ? `${model.fps} fps` : 'fps unavailable'
    filmstripMeta.value = `${model.clipLabel || 'No clip'} · ${model.items.length} frames · ${fpsLabel} · ${(model.durationMs / 1000).toFixed(2)}s · ${currentPosition}/${model.items.length}`
    filmstripMeta.textContent = filmstripMeta.value
    filmstripMeta.title = model.clipLabel || model.clipId

    const desiredKeys = new Set()
    const options = model.items.map((item) => {
      const candidateKey = viewModel.frameRepair?.candidate?.jobId ?? 'parent'
      const key = `${model.selectionKey}:${model.clipId}:${item.index}:${item.frameIndex}:${candidateKey}`
      desiredKeys.add(key)
      let entry = filmstripOptions.get(key)
      if (!entry) {
        const option = node(documentRef, 'button', 'editor-repair-frame-option')
        option.type = 'button'
        const thumbnail = node(documentRef, 'canvas', 'editor-repair-frame-thumbnail')
        thumbnail.width = 48
        thumbnail.height = 48
        thumbnail.setAttribute('aria-hidden', 'true')
        const label = node(documentRef, 'span')
        option.append(thumbnail, label)
        entry = { option, thumbnail, label }
        filmstripOptions.set(key, entry)
      }
      const { option, thumbnail, label } = entry
      option.dataset.frameOption = String(item.index)
      option.dataset.repaired = String(item.repaired === true)
      option.setAttribute('role', 'option')
      option.setAttribute('aria-selected', String(item.index === model.selectedIndex))
      option.setAttribute('aria-label', `${model.clipId} frame ${item.index + 1}, sheet frame ${item.frameIndex}${item.available ? '' : ', unavailable'}${item.repaired ? ', Repaired candidate' : ''}`)
      option.disabled = !item.available
      option.title = item.available ? item.repairedLabel ?? '' : 'This sheet frame is outside the decoded source image'
      option.tabIndex = item.index === model.selectedIndex && item.available ? 0 : -1
      drawFilmstripThumbnail(thumbnail, item, key)
      label.textContent = item.available ? String(item.index + 1) : `${item.index + 1} · unavailable`
      return option
    })
    for (const [key, entry] of filmstripOptions) {
      if (!desiredKeys.has(key)) {
        entry.option.remove()
        filmstripOptions.delete(key)
        renderedThumbnails.delete(key)
      }
    }
    options.forEach((option, index) => {
      if (filmstripFrames.children[index] !== option) filmstripFrames.insertBefore(option, filmstripFrames.children[index] ?? null)
    })
    filmstripFrames.tabIndex = model.items[model.selectedIndex]?.available ? -1 : 0
    const scrollKey = `${model.selectionKey}:${model.clipId}:${model.selectedIndex}`
    if (scrollKey !== lastScrolledFrame) {
      lastScrolledFrame = scrollKey
      options[model.selectedIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }

  const qualityRows = new Map()
  function renderQualityEvidence(viewModel) {
    for (const { label, value } of viewModel.qualityRows) {
      let row = qualityRows.get(label)
      if (!row) {
        row = { label: node(documentRef, 'dt', '', label), value: node(documentRef, 'dd') }
        qualityRows.set(label, row)
        qualityMetrics.append(row.label, row.value)
      }
      row.value.textContent = value == null ? 'Unavailable' : String(value)
    }
    qualityMetrics.setAttribute('aria-label', 'Preview quality and Canvas evidence')
  }

  function renderStateBanner(viewModel) {
    const state = buildRepairUiStateModel({
      state: viewModel.uiState,
      errorCode: viewModel.errorCode,
      details: viewModel.errorDetails,
      draftDirty: viewModel.canReset,
      canBuild: viewModel.canBuild,
      canAccept: viewModel.canAccept,
      warningConfirmed: viewModel.warningConfirmed,
    })
    stateBanner.dataset.tone = state.tone
    stateBanner.textContent = [state.message, state.errorText].filter(Boolean).join(' ')
    stateBanner.hidden = !stateBanner.textContent
    return state
  }

  function renderQualityGateAuthoringSurface(frameView = null) {
    const active = qualityGateAuthoring && frameView?.active === true
    const forbidden = [
      frameRepairPanel.element.querySelector('[data-frame-repair-control="provider"]')?.closest?.('label'),
      frameRepairPanel.element.querySelector('[data-frame-repair-control="image-size"]')?.closest?.('label'),
      frameRepairPanel.element.querySelector('[data-frame-repair-action="review"]'),
      frameRepairPanel.element.querySelector('[data-frame-repair-action="close"]'),
    ].filter(Boolean)
    for (const element of forbidden) {
      element.hidden = active
      element.inert = active
      if ('disabled' in element && active) element.disabled = true
    }
    qualityAuthoringActions.hidden = !active
    qualityAuthoringActions.inert = !active
    const canSave = active && String(frameView.instruction ?? '').trim().length > 0 &&
      Number(frameView.mask?.activePixelCount ?? 0) > 0 &&
      String(qualityGateAuthoringPayload?.expectedImprovement ?? '').trim().length > 0
    setDisabled(
      saveQualityCase,
      !canSave,
      canSave ? null : active ? 'Add an expected improvement, instruction, and non-empty rectangle mask before saving' : 'Case authoring is not active',
      'Save case definition',
    )
    setDisabled(cancelQualityCase, !active, active ? null : 'Case authoring is not active', 'Cancel case authoring')
  }

  function renderFrameRepairSurface(viewModel) {
    const active = viewModel.frameRepair?.active === true
    if (active) panPointer = null
    if (!active && frameRepairPointerId != null) {
      try { canvas.releasePointerCapture?.(frameRepairPointerId) } catch { /* Pointer capture may already be gone. */ }
      frameRepairPointerId = null
    }
    recipeBody.hidden = active
    recipeBody.inert = active
    aiAction.hidden = active
    aiAction.inert = active
    frameRepairPanel.element.hidden = !active
    frameRepairPanel.element.inert = !active
    quality.hidden = active
    quality.inert = active || workbench.dataset.recipeOpen === 'true'
    recipe.setAttribute('aria-label', active ? 'Frame Repair' : 'Processing Recipe')
    recipeTrigger.textContent = active ? 'Frame Repair' : 'Recipe'
    recipeTrigger.setAttribute('aria-label', active ? 'Open Frame Repair' : 'Open Processing Recipe')
    recipeClose.textContent = active ? 'Close Frame Repair panel' : 'Close Recipe'
    recipeBackdrop.textContent = active ? 'Close Frame Repair panel' : 'Close Recipe'
    recipeBackdrop.setAttribute('aria-label', active ? 'Close Frame Repair panel' : 'Close Processing Recipe')
    for (const control of overlays.querySelectorAll('[data-repair-overlay]')) {
      control.hidden = active && !['anchor', 'bbox'].includes(control.dataset.repairOverlay)
    }
    if (active) frameRepairPanel.render(viewModel.frameRepair)
    renderQualityGateAuthoringSurface(active ? viewModel.frameRepair : null)
    return active
  }

  function render(viewModel) {
    lastWorkbenchView = viewModel
    if (qualityGateOpen && viewModel.frameRepairEligibility?.enabled !== true) {
      closeQualityGate('ineligible')
    }
    const frameActive = renderFrameRepairSurface(viewModel)
    assetName.value.textContent = viewModel.assetName
    assetName.value.title = viewModel.assetName
    revisionId.value.textContent = viewModel.revisionId
    revisionId.value.title = viewModel.revisionId
    immutable.value.textContent = viewModel.immutableLabel
    previewState.value.textContent = frameActive ? viewModel.frameRepair.uiState : viewModel.previewState
    differenceSidecar.textContent = viewModel.differenceDiagnosticText
    for (const control of modes.querySelectorAll('[data-repair-mode]')) {
      const mode = control.dataset.repairMode
      const availability = viewModel.modeAvailability[mode] ?? { enabled: false, reason: 'mode_unavailable' }
      setDisabled(control, !availability.enabled, availability.reason, capitalized(mode))
      control.setAttribute('aria-pressed', String(viewModel.mode === mode))
    }
    for (const control of overlays.querySelectorAll('[data-repair-overlay]')) {
      const overlay = control.dataset.repairOverlay
      const availability = viewModel.overlayAvailability[overlay] ?? { enabled: false, reason: 'overlay_unavailable' }
      setDisabled(control, !availability.enabled, availability.reason, capitalized(overlay))
      control.setAttribute('aria-pressed', String(viewModel.overlays[overlay] === true))
    }
    setDisabled(reset, !viewModel.canReset, viewModel.resetReason, 'Reset draft')
    setDisabled(build, !viewModel.canBuild, viewModel.buildReason, 'Build Preview')
    setDisabled(accept, !viewModel.canAccept, viewModel.acceptReason, 'Accept as revision')
    diagnostics.textContent = viewModel.diagnosticText
    renderQualityEvidence(viewModel)
    warningLabel.hidden = !viewModel.warningRequired
    warningConfirmation.checked = viewModel.warningConfirmed
    zoomValue.value = `${Math.round(viewModel.zoom * 100)}%`
    zoomValue.textContent = zoomValue.value
    renderer.render(viewModel.renderFrame)
    renderGeometry(viewModel)
    renderRecipeControls(viewModel)
    renderFilmstrip(viewModel)
    if (viewModel.aiActionRenderKey !== lastAiActionRenderKey) {
      lastAiActionRenderKey = viewModel.aiActionRenderKey
      context?.renderAiAction(aiActionBody)
    }
    const uiState = renderStateBanner(viewModel)
    if (frameActive) {
      stateBanner.dataset.tone = viewModel.frameRepair.error ? 'blocking' : viewModel.frameRepair.uiState === 'warning' ? 'warning' : 'neutral'
      stateBanner.textContent = viewModel.frameRepair.message ?? ''
      stateBanner.hidden = !stateBanner.textContent
    }
    reset.disabled = !uiState.actionAvailability.reset
    build.disabled = !uiState.actionAvailability.build
    accept.disabled = !uiState.actionAvailability.accept
    discard.disabled = !uiState.actionAvailability.discard
    warningLabel.hidden = !viewModel.warningRequired
    warningConfirmation.disabled = !uiState.actionAvailability.confirmWarning && !viewModel.warningConfirmed
    const announcedState = frameActive ? `frame:${viewModel.frameRepair.uiState}` : viewModel.uiState
    if (announcedState !== lastAnnouncedPreviewState) {
      lastAnnouncedPreviewState = announcedState
      announce(frameActive ? viewModel.frameRepair.announcement : uiState.announcement)
    }
    if (qualityGateOpen && !qualityGateAuthoring) enterQualityWorkspace()
  }

  function attachQualityGate(runtime) {
    if (destroyed) return false
    if (qualityGateOpen && runtime !== qualityGateRuntime) closeQualityGate('runtime_switch')
    qualityGateRuntime = runtime && typeof runtime.getView === 'function' && typeof runtime.handleAction === 'function'
      ? runtime
      : null
    if (lastWorkbenchView) renderFilmstrip(lastWorkbenchView)
    return qualityGateRuntime !== null
  }

  function openQualityGate({ focus = false } = {}) {
    if (destroyed || !context || !qualityGateRuntime ||
        lastWorkbenchView?.frameRepairEligibility?.enabled !== true ||
        lastWorkbenchView?.frameRepair?.active === true) return false
    if (qualityGateOpen) {
      if (!qualityGateAuthoring) enterQualityWorkspace({ focus })
      return true
    }
    snapshotQualityWorkspaceHome()
    if (!qualityWorkspaceHome) return false
    qualityGateOpen = true
    qualityGateAuthoring = false
    const opened = enterQualityWorkspace({ focus })
    if (opened) void handleQualityGateAction('rehydrate')
    return opened
  }

  function closeQualityGate(_reason = 'close') {
    if (!qualityGateOpen && !qualityWorkspaceHome) return false
    restoreComparisonPresentation()
    qualityGateOpen = false
    qualityGateAuthoring = false
    qualityGateAuthoringPayload = null
    lastQualityGateView = null
    restoreQualityWorkspaceHome({ release: true })
    return true
  }

  syncNarrowDrawer()
  return Object.freeze({
    open(nextContext) {
      if (qualityGateOpen || qualityWorkspaceHome) closeQualityGate('selection_switched')
      if (workbench.parentNode !== root) root.replaceChildren(workbench)
      context = nextContext
      workbench.hidden = false
      closeRecipeDrawer({ restoreFocus: false })
      lifecycle.setSelection(nextContext.selection)
      render(nextContext.viewModel())
    },
    render,
    close(reason) {
      closeQualityGate(reason)
      closeRecipeDrawer({ restoreFocus: false })
      context?.onClose(reason)
      context = null
      frameRepairPointerId = null
      lastScrolledFrame = null
      workbench.hidden = true
    },
    attachQualityGate,
    openQualityGate,
    closeQualityGate,
    destroy() {
      if (destroyed) return
      closeQualityGate('destroy')
      closeRecipeDrawer({ restoreFocus: false })
      context?.onClose('destroy')
      context = null
      frameRepairPointerId = null
      destroyed = true
      frameRepairPanel.destroy()
      qualityGatePanel.destroy()
      renderer.destroy()
      for (const remove of listeners.splice(0)) remove()
      root.replaceChildren()
    },
  })
}
