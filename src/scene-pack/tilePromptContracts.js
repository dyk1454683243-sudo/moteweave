import { TOPDOWN_TILE_DUAL_GRID_V0, buildTileAtlasMetadata } from './tileProfile.js'

export const SCENE_TILE_PROMPT_CONTRACT_SCHEMA_VERSION = 1
export const SCENE_TILE_PROMPT_CONTRACT_VERSION = 'scene_tile_prompt_contract_v0_6'

const DEFAULT_DESCRIPTION = 'a cohesive topdown pixel-art terrain tile family'

const STYLE_RULES = Object.freeze([
  'Clean 16-bit pixel art terrain tiles with crisp silhouettes, readable clusters, and no blurred scaling.',
  'Use a consistent palette, outline weight, texture density, lighting direction, and pixel density across every tile.',
])

const NEGATIVE_RULES = Object.freeze([
  'Do not draw characters, creatures, portraits, weapons, props, text, labels, UI, borders, frame numbers, watermarks, or decorative callouts.',
  'Do not draw a completed map, room, scene, perspective illustration, or single large painting.',
  'Do not create a continuous scene sliced into cells; this is a tile inventory sheet, not a map screenshot.',
  'Do not add grid lines, gutters, captions, legends, row labels, column labels, coordinates, letters, or mask numbers inside the image.',
  'The 16 cells are not separate mini-scenes; they are one seamless terrain tile system.',
  'no diagonal path or rock vein may terminate at a tile edge unless the matching neighbor edge continues it.',
])

const RAW_STRUCTURE_RULES = Object.freeze([
  'Each runtime tile must read as a complete standalone tile that can be reused in many map positions.',
  'This is not a continuous scene sliced into cells; every tile must stand on its own.',
  'The 4x4 atlas is an inventory sheet: source-cell neighbors in the atlas are layout neighbors only, not world-space neighbors.',
  'Do not paint paths, rivers, cliffs, shadows, or texture strokes across source-cell boundaries.',
  'Keep each source cell internally coherent; avoid large terrain shapes that only make sense when the surrounding atlas cells are visible.',
  'Design every central runtime tile so it would still read correctly if the 16 cells were shuffled into a different source-cell order.',
  'No terrain stroke may continue from one source cell into the neighboring source cell; source-cell borders are layout dividers, not world-space edges.',
  'Keep large paths, cracks, rivers, cliffs, shadows, and texture bands fully contained inside one runtime tile unless the same motif is intentionally repeated on all compatible edge signatures.',
  'Do not use the 4x4 atlas position to create gradients, lighting, camera depth, or composition across rows or columns.',
  'Before drawing each source cell, imagine it being copied into a separate tile palette drawer; no road, river, cliff, shadow, highlight, or texture band may rely on adjacent source cells to finish its shape.',
])

const OUTPUT_CONTRACT_RULES = Object.freeze([
  'Final image file must be a true PNG image at exactly 192x192 pixels.',
  'Do not export or upscale the sheet to 1024x1024, 1K, or any display-preview size.',
  'Do not save JPEG image data with a .png filename.',
  'The image must contain only the tile source sheet pixels; no preview frame, page border, annotations, or extra whitespace.',
])

const SEAM_RULES = Object.freeze([
  'Every central runtime tile must have an outer 3 px border band designed for seamless tiling.',
  'For every runtime tile, the first and last pixel columns must be visually compatible when the tile repeats horizontally.',
  'For every runtime tile, the first and last pixel rows must be visually compatible when the tile repeats vertically.',
  'Tiles with the same edge signature must use the same terrain material, color ramp, texture density, and transition shape along that shared edge.',
  'Keep edge bands simple and continuous: avoid isolated stones, diagonal path endpoints, cut-off cliffs, or unique texture blobs touching a tile edge.',
  'Prove self-loop readiness inside each tile: north must repeat against south, west must repeat against east, and no unique edge mark should reveal the repeat.',
  'When an edge needs a motif, repeat the same edge motif on every tile with the same compatible edge signature instead of continuing a unique line across the atlas.',
  'Place no unique edge marks, corners, or color jumps on opposite borders that would reveal the self-loop repeat.',
])

const VALIDATION_EXPECTATIONS = Object.freeze([
  'exact_16_tile_dual_grid_atlas',
  'source_padding_preserved',
  'central_runtime_tile_area_clear',
  'row_major_mask_order_0_15',
  'visual_seam_ready_edges',
  'self_loop_ready_tiles',
  'loopable_runtime_border_bands',
  'shared_edge_signature_continuity',
  'raw_tile_structure_independent_cells',
  'source_atlas_not_single_scene',
  'source_cells_independent_after_shuffle',
  'no_cross_cell_terrain_continuity',
  'self_loop_edges_visible_in_each_tile',
  'no_atlas_scale_composition',
  'edge_signature_motifs_repeated_not_continued',
  'self_loop_edges_have_no_unique_marks',
  'true_png_192_source_sheet',
  'no_preview_scale_or_jpeg_encoded_png',
  'no_visible_mask_coordinates_or_labels',
  'shared_style_palette',
  'no_characters_text_ui_or_watermarks',
])

function normalizeDescription(description) {
  return String(description || DEFAULT_DESCRIPTION).trim() || DEFAULT_DESCRIPTION
}

function maskSummary(metadata) {
  return metadata.tiles
    .map((tile) => `mask ${tile.mask}: row ${tile.row}, column ${tile.col}`)
    .join('; ')
}

export function buildSceneTilePromptContract({ description = DEFAULT_DESCRIPTION, profile = TOPDOWN_TILE_DUAL_GRID_V0 } = {}) {
  const resolvedProfile = typeof profile === 'string' ? TOPDOWN_TILE_DUAL_GRID_V0 : profile
  const metadata = buildTileAtlasMetadata(resolvedProfile)
  return Object.freeze({
    schema_version: SCENE_TILE_PROMPT_CONTRACT_SCHEMA_VERSION,
    contract_version: SCENE_TILE_PROMPT_CONTRACT_VERSION,
    profile: resolvedProfile.id,
    subject: normalizeDescription(description),
    layout_kind: 'padded_dual_grid_tile_atlas',
    atlas_contract: Object.freeze({
      grid: Object.freeze({ ...resolvedProfile.grid }),
      tile: Object.freeze({ ...resolvedProfile.tile }),
      source: Object.freeze({
        sheet: Object.freeze({ ...resolvedProfile.source.sheet }),
        cell: Object.freeze({ ...resolvedProfile.source.cell }),
      }),
      tile_count: metadata.tiles.length,
      mask_order: Object.freeze(metadata.tiles.map((tile) => tile.mask)),
      mask_summary: maskSummary(metadata),
    }),
    style_contract: Object.freeze({ rules: STYLE_RULES }),
    negative_contract: Object.freeze({ rules: NEGATIVE_RULES }),
    output_contract: Object.freeze({ rules: OUTPUT_CONTRACT_RULES }),
    validation_contract: Object.freeze({ expectations: VALIDATION_EXPECTATIONS }),
  })
}

export function compileSceneTilePromptContract(contract = buildSceneTilePromptContract()) {
  return [
    `A precise pixel art terrain tile source sheet of: ${contract.subject}.`,
    `Profile: ${contract.profile}.`,
    `Canvas layout: exactly ${contract.atlas_contract.source.sheet.w}x${contract.atlas_contract.source.sheet.h} pixels.`,
    `Use exactly ${contract.atlas_contract.grid.columns} columns by ${contract.atlas_contract.grid.rows} rows with exactly ${contract.atlas_contract.tile_count} source cells total.`,
    `Each ${contract.atlas_contract.source.cell.w}x${contract.atlas_contract.source.cell.h} source cell must preserve ${contract.atlas_contract.source.cell.padding} px padding on every side.`,
    `Only the central ${contract.atlas_contract.tile.w}x${contract.atlas_contract.tile.h} tile area of each source cell is runtime tile art; the surrounding padding is generation safety margin.`,
    'Use row-major dual-grid mask order 0-15 internally. Do not write mask numbers, row labels, column labels, or coordinates anywhere in the image.',
    'Do not draw a visible legend or placement guide; the mask order is metadata, not artwork.',
    ...RAW_STRUCTURE_RULES,
    'Compatible edges must visually match when adjacent tiles share the same dual-grid corner signatures.',
    'Each tile should be self-loop ready: repeating the same tile horizontally or vertically should not create a visible hard seam.',
    ...SEAM_RULES,
    ...contract.style_contract.rules,
    ...contract.output_contract.rules,
    ...contract.negative_contract.rules,
    `Tile family: ${contract.subject}.`,
    'Only output the tile source sheet image.',
  ].join('\n')
}

export function summarizeSceneTilePromptContract(contract = buildSceneTilePromptContract()) {
  return {
    schema_version: contract.schema_version,
    contract_version: contract.contract_version,
    profile: contract.profile,
    layout_kind: contract.layout_kind,
    tile_count: contract.atlas_contract.tile_count,
    validation_expectations: contract.validation_contract.expectations,
  }
}
