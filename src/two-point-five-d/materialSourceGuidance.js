const SLOT_GUIDANCE = Object.freeze({
  top_material: Object.freeze({
    purpose: 'horizontal top face texture',
    target_content: 'Place the main walkable surface material here, with visible midtone texture variation.',
  }),
  side_material: Object.freeze({
    purpose: 'vertical side face texture',
    target_content: 'Place the side-wall or cliff material here, preferably darker than the top material.',
  }),
  edge_material: Object.freeze({
    purpose: 'rim and edge trim texture',
    target_content: 'Place readable rim detail here, with contrast against both top and side materials.',
  }),
  corner_material: Object.freeze({
    purpose: 'corner detail texture',
    target_content: 'Place corner accent material here, useful for inner and outer tile turns.',
  }),
  transition_detail: Object.freeze({
    purpose: 'terrain transition detail',
    target_content: 'Place blend-detail material here, such as grass-to-dirt crumbs or mixed edge pixels.',
  }),
  shadow_material: Object.freeze({
    purpose: 'contact shadow texture',
    target_content: 'Place dark but not fully black contact-shadow material here.',
  }),
  decal_material: Object.freeze({
    purpose: 'optional decal texture',
    target_content: 'Place optional small detail accents here; it can share the shadow region in the current MVP.',
  }),
})

function sourceIssueForWarning(warning) {
  if (warning === 'source_format_normalized_to_png') {
    return {
      code: warning,
      severity: 'info',
      message: 'The source was converted to PNG before sampling.',
      suggested_action: 'Export future material sources as PNG to avoid format ambiguity.',
    }
  }
  if (warning === 'source_size_normalized_to_target_canvas') {
    return {
      code: warning,
      severity: 'info',
      message: 'The source was resized to the material canvas before sampling.',
      suggested_action: 'Author future material sources at the contract canvas size to make sample regions easier to predict.',
    }
  }
  return {
    code: warning,
    severity: 'info',
    message: 'The source normalizer reported a non-blocking condition.',
    suggested_action: 'Review source_normalization.json for details.',
  }
}

function sampleIssueForWarning(warning, sample) {
  if (warning.startsWith('sample_region_empty_')) {
    return {
      code: warning,
      severity: 'warning',
      slot: sample.slot,
      message: 'This sample region has no visible pixels.',
      suggested_action: 'Fill this region with opaque material pixels for the slot before rebuilding.',
    }
  }
  if (warning.startsWith('sample_region_low_visible_coverage_')) {
    return {
      code: warning,
      severity: 'warning',
      slot: sample.slot,
      message: 'This sample region has too little visible material coverage.',
      suggested_action: 'Keep the region mostly filled; avoid sparse marks or mostly transparent source art.',
    }
  }
  if (warning.startsWith('sample_region_low_contrast_')) {
    return {
      code: warning,
      severity: 'warning',
      slot: sample.slot,
      message: 'This sample region has very low local contrast.',
      suggested_action: 'Add at least a few highlight and shadow pixels so the material reads as texture after pixel rendering.',
    }
  }
  if (warning.startsWith('sample_region_overexposed_')) {
    return {
      code: warning,
      severity: 'warning',
      slot: sample.slot,
      message: 'This sample region is very bright.',
      suggested_action: 'Darken the material or add midtone pixels so highlights do not collapse to a flat bright fill.',
    }
  }
  if (warning.startsWith('sample_region_underexposed_')) {
    return {
      code: warning,
      severity: 'warning',
      slot: sample.slot,
      message: 'This sample region is very dark.',
      suggested_action: 'Raise the midtones or add readable detail so the material does not collapse into shadow.',
    }
  }
  if (warning.startsWith('sample_region_overmixed_')) {
    return {
      code: warning,
      severity: 'warning',
      slot: sample.slot,
      message: 'This sample region appears to mix too many distinct source structures.',
      suggested_action: 'Use a tighter region or a source layout where this slot contains one coherent material patch.',
    }
  }
  return {
    code: warning,
    severity: 'warning',
    slot: sample.slot,
    message: 'This sample region triggered a material-source warning.',
    suggested_action: 'Review material_source_report.json and adjust this region.',
  }
}

function patchIssueForWarning(warning, sample) {
  if (warning.startsWith('material_patch_low_visible_coverage_')) {
    return {
      code: warning,
      severity: 'warning',
      slot: sample.slot,
      message: 'The extracted material patch has too much transparent or empty area.',
      suggested_action: 'Fill the source region with continuous material texture so the extracted patch can tile reliably.',
    }
  }
  if (warning.startsWith('material_patch_low_contrast_')) {
    return {
      code: warning,
      severity: 'warning',
      slot: sample.slot,
      message: 'The extracted material patch has very low contrast.',
      suggested_action: 'Add visible texture variation inside this region before rebuilding.',
    }
  }
  if (warning.startsWith('material_patch_low_color_variety_')) {
    return {
      code: warning,
      severity: 'warning',
      slot: sample.slot,
      message: 'The extracted material patch uses too few visible colors.',
      suggested_action: 'Add a small number of highlight, midtone, and shadow pixels to avoid flat repeated fills.',
    }
  }
  if (warning.startsWith('material_patch_repeat_edge_delta_')) {
    return {
      code: warning,
      severity: 'warning',
      slot: sample.slot,
      message: 'The extracted material patch has mismatched opposing edges.',
      suggested_action: 'Keep the left/right and top/bottom edges visually compatible so repeated patch fills do not form obvious seams.',
    }
  }
  return {
    code: warning,
    severity: 'warning',
    slot: sample.slot,
    message: 'The extracted material patch triggered a quality warning.',
    suggested_action: 'Review material_patches.png and adjust this source region.',
  }
}

function materialIssueForWarning(warning) {
  if (warning.startsWith('material_slot_low_distinction_')) {
    return {
      code: warning,
      severity: 'warning',
      message: 'Two required material slots are too visually similar.',
      suggested_action: 'Review slot_separation first; if warnings remain, make the source regions more distinct for top, side, edge, corner, transition, and shadow materials.',
    }
  }
  return {
    code: warning,
    severity: 'warning',
    message: 'The material extraction stage reported a non-sample-specific warning.',
    suggested_action: 'Review material_source_report.json and material_patches.png for details.',
  }
}

function normalizedRect(rect, sourceSize) {
  return {
    x: Number((rect.x / sourceSize.width).toFixed(4)),
    y: Number((rect.y / sourceSize.height).toFixed(4)),
    w: Number((rect.w / sourceSize.width).toFixed(4)),
    h: Number((rect.h / sourceSize.height).toFixed(4)),
  }
}

function guidanceForSample(sample, sourceSize) {
  const guidance = SLOT_GUIDANCE[sample.slot] ?? {
    purpose: `${sample.role} material texture`,
    target_content: 'Place opaque, readable material texture in this sample region.',
  }
  return {
    slot: sample.slot,
    material_id: sample.material_id,
    role: sample.role,
    purpose: guidance.purpose,
    target_content: guidance.target_content,
    sample_region: sample.sample_region,
    normalized_region: normalizedRect(sample.sample_region, sourceSize),
    status: sample.diagnostics.status === 'warning' || sample.patch_diagnostics?.status === 'warning' ? 'warning' : 'pass',
    metrics: sample.diagnostics.metrics,
    patch: sample.patch
      ? {
          id: sample.patch.id,
          size: sample.patch.size,
          source_rect: sample.patch.source_rect,
        }
      : null,
    patch_metrics: sample.patch_diagnostics?.metrics ?? null,
    sampled_colors: sample.colors,
    issues: [
      ...sample.diagnostics.warnings.map((warning) => sampleIssueForWarning(warning, sample)),
      ...(sample.patch_diagnostics?.warnings ?? []).map((warning) => patchIssueForWarning(warning, sample)),
    ],
  }
}

function layoutSelectionGuidance(layoutSelection) {
  if (!layoutSelection?.selected) return null
  return {
    mode: layoutSelection.mode,
    selected_id: layoutSelection.selected.id,
    selected_score: layoutSelection.selected.score,
    candidate_count: layoutSelection.candidates?.length ?? 0,
    rejected: (layoutSelection.rejected ?? []).map((candidate) => ({
      id: candidate.id,
      score: candidate.score,
      score_reasons: candidate.score_reasons,
    })),
    decision: layoutSelection.decision,
  }
}

function semanticSlotSelectionGuidance(selection) {
  if (!selection) return null
  return {
    mode: selection.mode,
    layout_id: selection.layout_id,
    candidate_count: selection.candidate_count ?? 0,
    slots: (selection.slots ?? []).map((slot) => ({
      slot: slot.slot,
      selected_candidate_id: slot.selected?.candidate_id ?? null,
      score: slot.selected?.score ?? null,
      source_kind: slot.selected?.source_kind ?? null,
      origin_slot: slot.selected?.origin_slot ?? null,
      rejected_count: slot.rejected?.length ?? 0,
    })),
  }
}

function slotSeparationGuidance(separation) {
  if (!separation) return null
  return {
    mode: separation.mode,
    status: separation.status,
    threshold: separation.threshold,
    initial_warning_count: separation.initial_warning_count ?? 0,
    remaining_warning_count: separation.remaining_warning_count ?? 0,
    changed_slot_count: separation.changed_slot_count ?? 0,
    changed_slots: (separation.changed_slots ?? []).map((slot) => ({
      slot: slot.slot,
      material_id: slot.material_id,
      base_distance_from_source: slot.base_distance_from_source,
      patch_recolored: Boolean(slot.patch_recolored),
    })),
  }
}

export function buildMaterialSourceAuthoringGuidance({
  sourceNormalization,
  materialSourceReport,
} = {}) {
  if (!materialSourceReport) {
    throw new Error('materialSourceReport is required for material source authoring guidance')
  }
  const sourceIssues = (sourceNormalization?.warnings ?? []).map(sourceIssueForWarning)
  const sourceSize = materialSourceReport.sampling.source_size
  const slots = materialSourceReport.sampling.samples.map((sample) => guidanceForSample(sample, sourceSize))
  const slotIssues = slots.flatMap((slot) => slot.issues)
  const coveredSlotWarnings = new Set(materialSourceReport.sampling.samples.flatMap((sample) => [
    ...(sample.diagnostics?.warnings ?? []),
    ...(sample.patch_diagnostics?.warnings ?? []),
  ]))
  const materialIssues = (materialSourceReport.quality_gates?.warnings ?? [])
    .filter((warning) => !coveredSlotWarnings.has(warning))
    .map(materialIssueForWarning)
  const issueCount = sourceIssues.length + slotIssues.length + materialIssues.length
  return {
    schema_version: 1,
    mode: 'two_point_five_d_material_source_authoring_guidance_v0',
    status: issueCount ? 'warning' : 'pass',
    source_id: materialSourceReport.source_id,
    material_profile_id: materialSourceReport.material_profile_id,
    source_canvas: {
      expected_width: sourceNormalization?.output?.width ?? sourceSize.width,
      expected_height: sourceNormalization?.output?.height ?? sourceSize.height,
      normalized_artifact: sourceNormalization?.output?.artifact ?? 'normalized_material_source.png',
    },
    layout_selection: layoutSelectionGuidance(materialSourceReport.layout_selection),
    semantic_slot_selection: semanticSlotSelectionGuidance(materialSourceReport.semantic_slot_selection),
    slot_separation: slotSeparationGuidance(materialSourceReport.slot_separation),
    sampling_layout: {
      id: materialSourceReport.sampling.layout,
      source_size: sourceSize,
      slots,
    },
    extraction: materialSourceReport.extraction
      ? {
          mode: materialSourceReport.extraction.mode,
          patch_size: materialSourceReport.extraction.patch_size,
          palette_limit: materialSourceReport.extraction.palette_limit ?? null,
          tileability: materialSourceReport.extraction.tileability ?? null,
          patch_count: materialSourceReport.extraction.patch_count,
          warning_patch_count: materialSourceReport.extraction.warning_patch_count,
        }
      : null,
    issues: [...sourceIssues, ...slotIssues, ...materialIssues],
    checklist: [
      'Use one material source image as raw material input, not as a final tileset atlas.',
      'Keep each configured sample region mostly filled with opaque pixels.',
      'Give every region visible midtone, highlight, and shadow variation.',
      'Keep extracted patch edges compatible enough that repeated fills do not show obvious seams.',
      'Keep top, side, edge, corner, transition, shadow, and decal regions visually distinct.',
      'Rebuild and inspect material_source_samples.png after changing the source image or layout.',
      'Inspect material_patches.png before trusting the strict atlas render.',
    ],
  }
}

export function renderMaterialSourceAuthoringGuidanceMarkdown(guidance) {
  const lines = [
    '# 2.5D Material Source Guidance',
    '',
    `Status: ${guidance.status}`,
    `Source: ${guidance.source_id}`,
    `Material profile: ${guidance.material_profile_id}`,
    '',
    '## Canvas',
    '',
    `Expected canvas: ${guidance.source_canvas.expected_width} x ${guidance.source_canvas.expected_height}`,
    `Normalized artifact: ${guidance.source_canvas.normalized_artifact}`,
    '',
    '## Layout Selection',
    '',
    `Mode: ${guidance.layout_selection?.mode ?? 'not_available'}`,
    `Selected: ${guidance.layout_selection?.selected_id ?? guidance.sampling_layout.id}`,
    `Candidate count: ${guidance.layout_selection?.candidate_count ?? 1}`,
    guidance.layout_selection?.decision ? `Decision: ${guidance.layout_selection.decision}` : '',
    '',
    '## Slot Selection',
    '',
    `Mode: ${guidance.semantic_slot_selection?.mode ?? 'not_available'}`,
    `Candidate count: ${guidance.semantic_slot_selection?.candidate_count ?? 0}`,
    '',
    '## Slot Separation',
    '',
    `Mode: ${guidance.slot_separation?.mode ?? 'not_available'}`,
    `Status: ${guidance.slot_separation?.status ?? 'not_available'}`,
    `Initial warnings: ${guidance.slot_separation?.initial_warning_count ?? 0}`,
    `Remaining warnings: ${guidance.slot_separation?.remaining_warning_count ?? 0}`,
    `Changed slots: ${guidance.slot_separation?.changed_slot_count ?? 0}`,
    '',
    '## Extraction',
    '',
    `Mode: ${guidance.extraction?.mode ?? 'not_available'}`,
    `Palette limit: ${guidance.extraction?.palette_limit?.status ?? 'not_available'}`,
    `Tileability: ${guidance.extraction?.tileability?.status ?? 'not_available'}`,
    `Patch count: ${guidance.extraction?.patch_count ?? 0}`,
    `Warning patch count: ${guidance.extraction?.warning_patch_count ?? 0}`,
    '',
    '## Sample Regions',
    '',
  ]
  for (const slot of guidance.sampling_layout.slots) {
    lines.push(
      `### ${slot.slot}`,
      '',
      `Purpose: ${slot.purpose}`,
      `Target: ${slot.target_content}`,
      `Status: ${slot.status}`,
      `Region: x=${slot.sample_region.x}, y=${slot.sample_region.y}, w=${slot.sample_region.w}, h=${slot.sample_region.h}`,
      `Metrics: coverage=${slot.metrics.visible_coverage_ratio}, luma_range=${slot.metrics.luma_range}, median=${slot.metrics.luma_median}`,
      slot.patch ? `Patch: ${slot.patch.id} (${slot.patch.size.width} x ${slot.patch.size.height})` : 'Patch: not_available',
      ''
    )
    if (slot.issues.length) {
      lines.push('Issues:')
      for (const issue of slot.issues) lines.push(`- ${issue.code}: ${issue.suggested_action}`)
      lines.push('')
    }
  }
  lines.push('## Checklist', '')
  for (const item of guidance.checklist) lines.push(`- ${item}`)
  if (guidance.issues.length) {
    lines.push('', '## All Issues', '')
    for (const issue of guidance.issues) {
      const slot = issue.slot ? `${issue.slot}: ` : ''
      lines.push(`- ${slot}${issue.code}: ${issue.suggested_action}`)
    }
  }
  lines.push('')
  return lines.join('\n')
}
