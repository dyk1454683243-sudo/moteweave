export const TWO_POINT_FIVE_D_MATERIAL_SOURCE_PROMPT_CONTRACT_VERSION = 'two_point_five_d_material_source_prompt_contract_v1_0'
export const TWO_POINT_FIVE_D_MATERIAL_SOURCE_PROMPT_MODE = 'two_point_five_d_material_source_prompt'

const FIELD_LABELS = Object.freeze({
  terrain: 'Terrain or biome',
  topMaterial: 'Top surface material',
  sideMaterial: 'Side wall material',
  edgeMaterial: 'Edge trim material',
  cornerMaterial: 'Corner material',
  transitionDetail: 'Transition detail',
  shadowMaterial: 'Shadow/contact material',
  decalMaterial: 'Optional decal material',
  style: 'Style notes',
  palette: 'Palette notes',
  lighting: 'Lighting notes',
  notes: 'Additional notes',
  negative: 'Extra negative constraints',
})

const FIELD_ALIASES = Object.freeze({
  biome: 'terrain',
  top: 'topMaterial',
  top_material: 'topMaterial',
  side: 'sideMaterial',
  side_material: 'sideMaterial',
  edge: 'edgeMaterial',
  edge_material: 'edgeMaterial',
  corner: 'cornerMaterial',
  corner_material: 'cornerMaterial',
  transition: 'transitionDetail',
  transition_detail: 'transitionDetail',
  shadow: 'shadowMaterial',
  shadow_material: 'shadowMaterial',
  decal: 'decalMaterial',
  decal_material: 'decalMaterial',
  color: 'palette',
  colors: 'palette',
})

function cleanText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

function normalizePair(value, fallback) {
  if (!Array.isArray(value) || value.length !== 2) return fallback
  const pair = value.map(Number)
  return pair.every((item) => Number.isInteger(item) && item > 0) ? pair : fallback
}

function normalizePromptFields(fields = {}) {
  const result = {}
  for (const [rawKey, rawValue] of Object.entries(fields ?? {})) {
    const key = FIELD_ALIASES[rawKey] ?? rawKey
    if (!FIELD_LABELS[key]) continue
    const value = cleanText(rawValue)
    if (value) result[key] = value
  }
  return result
}

function materialSlotsFromContract(contract = {}) {
  const slots = contract.materials?.slots ?? {}
  return {
    top_material: slots.top_material ?? 'grass_top',
    side_material: slots.side_material ?? 'dirt_side',
    edge_material: slots.edge_material ?? 'grass_edge',
    corner_material: slots.corner_material ?? 'grass_corner',
    transition_detail: slots.transition_detail ?? 'grass_to_dirt_edge',
    shadow_material: slots.shadow_material ?? 'soft_contact_shadow',
    decal_material: slots.decal_material ?? 'optional_decal',
  }
}

function contractProjectionSummary(contract = {}) {
  return {
    type: cleanText(contract.projection?.type || 'orthographic_2_5d'),
    logical_tile_size: normalizePair(contract.projection?.logical_tile_size, [32, 32]),
    sprite_cell_size: normalizePair(contract.projection?.sprite_cell_size, [64, 64]),
    pivot: cleanText(contract.projection?.pivot || 'bottom_center'),
    fixed_height_px: Number.isInteger(contract.projection?.fixed_height_px) ? contract.projection.fixed_height_px : 24,
  }
}

function canvasHintFromContract(contract = {}) {
  const width = Number(contract.canvas?.width ?? contract.atlas?.strict_size?.[0] ?? 1024)
  const height = Number(contract.canvas?.height ?? contract.atlas?.strict_size?.[1] ?? 1024)
  return {
    width: Number.isInteger(width) && width > 0 ? width : 1024,
    height: Number.isInteger(height) && height > 0 ? height : 1024,
  }
}

export function buildTwoPointFiveDMaterialSourcePromptContract({
  description = '',
  promptFields = {},
  contract = {},
} = {}) {
  const fields = normalizePromptFields({
    terrain: description,
    ...promptFields,
  })
  const projection = contractProjectionSummary(contract)
  const canvas = canvasHintFromContract(contract)
  return {
    schema_version: 1,
    contract_version: TWO_POINT_FIVE_D_MATERIAL_SOURCE_PROMPT_CONTRACT_VERSION,
    mode: TWO_POINT_FIVE_D_MATERIAL_SOURCE_PROMPT_MODE,
    source_role: 'raw_material_source_not_clean_atlas',
    requested_aspect_ratio: '1:1',
    canvas_hint: canvas,
    projection,
    material_slots: materialSlotsFromContract(contract),
    prompt_fields: fields,
    validation_expectations: [
      'square_raw_material_source',
      'distinct_material_regions',
      'no_final_atlas_grid',
      'no_mask_labels_or_coordinates',
      'no_ui_text_or_watermarks',
      'crisp_limited_palette_pixel_style',
      'local_pipeline_owns_tile_rules_pivots_collision_and_exports',
    ],
    downstream_pipeline: {
      normalizer: 'source_normalizer_v0',
      material_builder: 'manual_material_extraction_v1',
      rule_aware_composer: 'terrain_autotile_builder_v1',
      validator: 'tileset_pixel_validator_v0',
      exporter: 'atlas_exporter_v1',
    },
    claim_boundary: 'Provider output is only a raw material/style source. The local deterministic pipeline owns source normalization, slot extraction, tile masks, pivots, collision metadata, atlas structure, validation, and exports.',
  }
}

export function summarizeTwoPointFiveDMaterialSourcePromptContract(contract = {}) {
  return {
    schema_version: 1,
    contract_version: contract.contract_version ?? TWO_POINT_FIVE_D_MATERIAL_SOURCE_PROMPT_CONTRACT_VERSION,
    mode: contract.mode ?? TWO_POINT_FIVE_D_MATERIAL_SOURCE_PROMPT_MODE,
    source_role: contract.source_role ?? 'raw_material_source_not_clean_atlas',
    requested_aspect_ratio: contract.requested_aspect_ratio ?? '1:1',
    canvas_hint: contract.canvas_hint ?? { width: 1024, height: 1024 },
    projection: contract.projection ?? contractProjectionSummary(),
    material_slots: contract.material_slots ?? materialSlotsFromContract(),
    prompt_fields: contract.prompt_fields ?? {},
    validation_expectations: contract.validation_expectations ?? [],
    downstream_pipeline: contract.downstream_pipeline ?? {},
    claim_boundary: contract.claim_boundary,
  }
}

function promptFieldLines(fields = {}) {
  return Object.entries(fields)
    .filter(([key, value]) => FIELD_LABELS[key] && cleanText(value))
    .map(([key, value]) => `${FIELD_LABELS[key]}: ${cleanText(value)}`)
}

export function compileTwoPointFiveDMaterialSourcePromptContract(contract = {}) {
  const summary = summarizeTwoPointFiveDMaterialSourcePromptContract(contract)
  const fieldLines = promptFieldLines(summary.prompt_fields)
  const slotLines = Object.entries(summary.material_slots).map(([slot, materialId]) => `- ${slot}: ${materialId}`)
  return [
    'Create one square raw material source image for a deterministic 2.5D pixel terrain tileset pipeline.',
    'This is not the final tileset asset. Do not create a strict atlas, tile grid, mask chart, coordinate sheet, numbered template, UI panel, labels, frame text, or watermark.',
    fieldLines.length ? `Subject and style brief:\n${fieldLines.map((line) => `- ${line}`).join('\n')}` : 'Subject and style brief: generic original fantasy terrain materials.',
    `Projection context for downstream code: ${summary.projection.type}, logical tile ${summary.projection.logical_tile_size.join('x')}, sprite cell ${summary.projection.sprite_cell_size.join('x')}, pivot ${summary.projection.pivot}, fixed visual height ${summary.projection.fixed_height_px}px.`,
    `Preferred composition: one 1:1 material reference board, preferably around ${summary.canvas_hint.width}x${summary.canvas_hint.height} if the provider supports that size. Exact pixel dimensions are not required because local code will normalize the source.`,
    `Include clearly separated reusable material regions for:\n${slotLines.join('\n')}`,
    'Material guidance: top surfaces should read differently from side walls; edge trim and corners should be visually distinct; transition details should work as small repeated overlays; shadow/contact material should stay subdued.',
    'Pixel style: clean readable 16-bit pixel art, deliberate chunky pixel clusters, crisp edges, limited palette, no painterly blur, no soft anti-aliased rendering, no photographic texture.',
    'Scene constraints: no characters, no creatures, no large props, no weapons, no logo-like symbols, no text, no UI, no perspective poster composition, no named franchise or branded style references.',
    'Downstream handoff: local deterministic code will crop/sample materials, generate corner masks, compose top/front/side faces, set pivots, validate pixels, and export PNG/JSON/Tiled/LDtk artifacts.',
    'Goal: provide useful raw material and style variation only; structural correctness belongs to the local pipeline.',
  ].join('\n\n')
}
