import { TOPDOWN_RPG_V0 } from './profile.js'
import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  getSourceLayoutActions,
  resolveSourceLayout,
} from './sourceLayouts.js'
import {
  compileStructuredSubject,
  normalizeCharacterT2iPreset,
  normalizePromptFields,
  TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET,
} from './textToImagePrompt.js'

export const PROMPT_CONTRACT_SCHEMA_VERSION = 1
export const PROMPT_CONTRACT_VERSION = 'character_prompt_contract_v1_15'

const DEFAULT_SUBJECT = 'a readable fantasy pixel RPG character'

const STYLE_RULES = Object.freeze([
  'Clean 16-bit pixel art style, high contrast, strictly flat 2D silhouettes.',
  'Create one complete game-ready pixel art character sprite sheet.',
])

const IDENTITY_RULES = Object.freeze([
  'Keep the same character identity, scale, outline thickness, palette, pixel density, lighting, and costume in every frame.',
])

function backgroundRulesFor(backgroundMode = 'auto') {
  const mode = String(backgroundMode || 'auto').trim()
  if (mode === 'alpha' || mode === 'transparent' || mode === 'passthrough') {
    return Object.freeze([
      'The background must be transparent if the provider supports alpha; otherwise use pure white #ffffff.',
      'Do not draw checkerboard, gradient, shadow, scenery, ground, or transparent-looking pattern behind the character.',
    ])
  }
  if (mode === 'edge_palette') {
    return Object.freeze([
      'The background must be one flat removable solid color.',
      'Do not draw checkerboard, gradient, shadow, scenery, ground, or textured background behind the character.',
    ])
  }
  return Object.freeze([
    'The background must be pure white, pure black, or transparent only if explicitly requested; otherwise use pure white #ffffff.',
    'Use pure white #ffffff background with no checkerboard, gradient, shadow, scenery, ground, or transparent-looking pattern.',
  ])
}

const NEGATIVE_RULES = Object.freeze([
  'Default to empty hands: do not add ladders, weapons, shields, tools, props, or handheld items unless the written character description explicitly requests them.',
  'Keep each pose as one clean character silhouette: no extra or duplicated arms or hands, ghost limbs, motion blur, action trails, afterimages, summoned limbs, copied effects, signature powers, or extra anatomy unless explicitly requested.',
  'Show motion across frames or regions, not as multiple limb positions inside one cell or region.',
  'Do not include text, numbers, labels, UI, captions, grid lines, frame boxes, borders, watermark, scenery, or extra characters.',
])

const STRUCTURAL_TEMPLATE_RULES = Object.freeze([
  'Strictly use the provided image as a structural layout template.',
  'Preserve the exact layout, frame count, grid structure, and poses defined in the template.',
])

const COMPLETENESS_EXPECTATIONS = Object.freeze([
  'no_empty_cells',
  'no_blank_or_near_blank_cells',
  'no_cropped_or_edge_cut_character',
  'full_body_visible_in_every_cell',
  'minimum_character_occupancy_per_cell',
  'maximum_edge_pressure_per_cell',
  'consistent_cell_scale',
  'consistent_cell_padding',
  'no_partial_body_closeups',
  'explicit_row_column_segment_map',
  'template_empty_cells_must_be_filled',
  'layout_template_has_priority_over_reference_images',
  'reference_images_must_not_override_layout',
])

function normalizeSubject(description) {
  return String(description || DEFAULT_SUBJECT).trim() || DEFAULT_SUBJECT
}

function normalizePreset(preset) {
  try {
    return resolveSourceLayout(preset).id
  } catch {
    return TOPDOWN_RPG_V0.id
  }
}

function readableAnimationName(name) {
  return String(name).replace(/_/g, ' ')
}

function summarizeTopdownRows(profile = TOPDOWN_RPG_V0) {
  const byRow = new Map()
  for (const animation of profile.animations) {
    const existing = byRow.get(animation.row) ?? []
    existing.push(readableAnimationName(animation.name))
    byRow.set(animation.row, existing)
  }
  return [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, names]) => {
      if (names.length === 2) {
        const [left, right] = names
        const [leftPrefix, leftSuffix] = left.split(' ')
        const [rightPrefix, rightSuffix] = right.split(' ')
        if (leftPrefix === rightPrefix && leftSuffix && rightSuffix) return `${leftPrefix} ${leftSuffix}/${rightSuffix}`
      }
      return names.join(', ')
    })
    .join(', ')
}

function describeTopdownSegmentMap(profile = TOPDOWN_RPG_V0) {
  return profile.animations
    .slice()
    .sort((a, b) => a.row - b.row || a.startCol - b.startCol)
    .map((animation) => {
      const endCol = animation.startCol + animation.count - 1
      return `row ${animation.row} columns ${animation.startCol}-${endCol} = ${readableAnimationName(animation.name)}`
    })
    .join('; ')
}

function buildTopdownLayoutContract() {
  const profile = TOPDOWN_RPG_V0
  return Object.freeze({
    id: profile.id,
    label: '8x8 uniform grid',
    kind: 'uniform_grid',
    frame_count: profile.grid.columns * profile.grid.rows,
    grid: profile.grid,
    sheet: profile.sheet,
    template_role: 'strict_structural_uniform_grid',
    prompt_lines: Object.freeze([
      'Canvas layout: exactly 8 columns by 8 rows, one complete sprite sheet image.',
      'The output must contain exactly 64 cells total. Do not add extra columns, extra rows, side panels, bonus poses, or repeated layout blocks.',
      'Every required cell must contain one visible complete character pose; no cell may be blank, empty, white-only, transparent-only, or background-only.',
      'The full character body must remain inside each cell with clear padding on all sides; do not crop heads, feet, hands, hair, clothing, or pose silhouettes at cell boundaries.',
      'Do not draw only a head, torso, limb, close-up, silhouette fragment, or partial body in any required frame.',
      'Every cell must have equal size, consistent spacing, and a fixed feet-center anchor.',
      'Do not use a one-image fixed-region motion layout, wide action strips, variable-width cells, or source action region maps.',
      'The 8x8 grid contract overrides any attached image if the image appears to suggest a different layout.',
      'Do not reorder rows, columns, directions, or animation groups. Do not move cell boundaries or merge cells.',
      `Rows: ${summarizeTopdownRows(profile)}.`,
      'Each row is split into two required 4-frame animation segments: columns 0-3 are the first action named for the row, and columns 4-7 are the second action named for the row.',
      `Topdown row/column map: ${describeTopdownSegmentMap(profile)}.`,
      'Each animation segment has 4 frames. Walk cycles must show visible left-foot/right-foot alternation.',
      'If the attached template has empty-looking cells, missing poses, tan or white padding, uneven gaps, or partial cropped placeholder art, the output must still fill those cells with complete character poses according to the topdown row/column map.',
      'Do not copy empty template cells, missing placeholder cells, or cropped placeholder edges from the template; those are template defects, not output permissions.',
      'Frames 40-43 (attack left) and 44-47 (attack right) are high-risk horizontal attack cells: keep the complete silhouette inside each cell with clear left and right padding.',
      'Keep weapons, staffs, shields, tools, capes, spell effects, and stretched arms compact in horizontal attack cells; shorten, tuck, or angle them close to the body rather than letting them touch or cross cell edges.',
    ]),
    validation_expectations: Object.freeze([
      'exact_8x8_grid',
      'exact_64_cells',
      'stable_feet_center_anchor',
      'consistent_character_identity',
      'pure_background',
      'no_extra_props_or_scenery',
      ...COMPLETENESS_EXPECTATIONS,
      'compact_horizontal_attack_rows',
    ]),
  })
}

function buildFixedRegionMotionLayoutContract() {
  const layout = resolveSourceLayout(FIXED_REGION_MOTION_LAYOUT_ID)
  const sourceActions = getSourceLayoutActions(layout).map((action) => action.action)
  return Object.freeze({
    id: layout.id,
    label: layout.label,
    kind: layout.kind,
    sheet: layout.sheet,
    source_actions: Object.freeze(sourceActions),
    template_role: 'strict_structural_fixed_regions',
    prompt_lines: Object.freeze([
      'Canvas layout: one square sprite sheet image using the fixed-region motion source layout shown by the first attached template image.',
      'Use the first attached template image as the structural template for format, region placement, action order, body orientation, facing direction, silhouette rhythm, pose rhythm, sprite proportion, sprite scale, spacing, canvas size, canvas ratio, sprite sheet layout, pixel art style, and output rules.',
      'Replace only the placeholder character with the requested subject; preserve the template layout and motion plan.',
      'If more than one template image is attached before the subject reference, infer the shared layout, pose language, proportions, pixel-art style, and output rules from those template images.',
      'Do not target a literal tiny pixel canvas size; render a clean square image that local post-processing can hard-scale into the final source sheet.',
      'Every required fixed region should contain one complete readable character pose for that source action.',
      'Keep the whole character inside each assigned fixed region with clear padding.',
      'Do not convert this layout into an 8x8 grid. Do not add extra columns, extra rows, side panels, bonus poses, or repeated layout blocks.',
      `The source template action semantics are: ${sourceActions.join(', ')}.`,
      'Replace every template pose one-for-one in its original fixed region. Do not move, swap, borrow, duplicate, or invent a pose for a neighboring action region.',
      'Facing-direction contract: idledown, walkdown, and rundown face toward the viewer; idleup, walkup, and runup face away from the viewer; idleL, walkL, runL, and attractL face screen-left. Never substitute a front, back, or side view for another direction.',
      'Within every numbered multi-region action, keep one camera view and one facing direction across the entire action. Change only the body and limb phase; never rotate the character between front, back, and side views.',
      'All six walk or run regions for one named action belong to that action and direction only. Do not mix walk, run, idle, climb, defence, or poses from an adjacent action group.',
      'All six climb regions must keep one consistent climb-facing view matching the template while showing coherent alternating climbing phases. Do not turn between front, back, and side views.',
      'Do not infer or move action boundaries from whitespace, sprite size, or neighboring poses; the fixed regions and their action ownership in the template are authoritative.',
      'Draw the matching body motion for each template action: idle, walk, run, empty-hand action, attract/interact gesture, jump, sit, defence stance, death/downed, and climb-style body motion.',
      'Static single-region actions remain single source poses; multi-region actions should show readable phase changes across their numbered source regions.',
      'Use pure pixel-art character silhouettes only, with consistent identity, costume, palette, outline, and pixel density across the whole sheet.',
    ]),
    validation_expectations: Object.freeze([
      'exact_fixed_region_layout',
      'preserve_source_action_regions',
      'stable_feet_center_anchor',
      'consistent_character_identity',
      'pure_background',
      'no_extra_props_or_scenery',
      ...COMPLETENESS_EXPECTATIONS,
      'manual_fixed_region_direction_consistency',
      'manual_fixed_region_action_boundary_review',
    ]),
  })
}

const LAYOUT_CONTRACT_BUILDERS = Object.freeze({
  topdown_rpg_v0: buildTopdownLayoutContract,
  [FIXED_REGION_MOTION_LAYOUT_ID]: buildFixedRegionMotionLayoutContract,
})

export function buildCharacterPromptContract({
  description = '',
  preset = TOPDOWN_RPG_V0.id,
  promptFields = {},
  characterPreset,
  backgroundMode = 'auto',
  t2iMode = TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET,
} = {}) {
  const normalizedPreset = normalizePreset(preset)
  const layoutBuilder = LAYOUT_CONTRACT_BUILDERS[normalizedPreset] ?? LAYOUT_CONTRACT_BUILDERS[TOPDOWN_RPG_V0.id]
  const layoutContract = layoutBuilder()
  const structuredFields = normalizePromptFields(promptFields)
  const characterPresetInfo = normalizeCharacterT2iPreset(characterPreset)
  return Object.freeze({
    schema_version: PROMPT_CONTRACT_SCHEMA_VERSION,
    contract_version: PROMPT_CONTRACT_VERSION,
    preset: layoutContract.id,
    t2i_mode: t2iMode,
    subject: normalizeSubject(description),
    structured_subject: normalizeSubject(compileStructuredSubject({ description, promptFields: structuredFields, characterPreset: characterPresetInfo.id })),
    prompt_fields: Object.freeze(structuredFields),
    character_preset: Object.freeze({
      id: characterPresetInfo.id,
      label: characterPresetInfo.label,
    }),
    template_contract: Object.freeze({
      role: layoutContract.template_role,
      structural_rules: STRUCTURAL_TEMPLATE_RULES,
    }),
    layout_contract: layoutContract,
    identity_contract: Object.freeze({ rules: IDENTITY_RULES }),
    style_contract: Object.freeze({ rules: STYLE_RULES }),
    background_contract: Object.freeze({ mode: backgroundMode, rules: backgroundRulesFor(backgroundMode) }),
    negative_contract: Object.freeze({ rules: NEGATIVE_RULES }),
    validation_contract: Object.freeze({ expectations: layoutContract.validation_expectations }),
  })
}

function linesFromContract(contract) {
  return [
    `A precise pixel art sprite sheet of: ${contract.structured_subject ?? contract.subject}.`,
    ...contract.template_contract.structural_rules,
    contract.background_contract.rules[0],
    ...contract.style_contract.rules,
    `Profile: ${contract.preset}.`,
    ...contract.layout_contract.prompt_lines,
    ...contract.identity_contract.rules,
    contract.background_contract.rules[1],
    ...contract.negative_contract.rules,
    `Character: ${contract.structured_subject ?? contract.subject}`,
    'Only output the sprite sheet image.',
  ]
}

export function compileCharacterPromptContract(contract) {
  const resolvedContract = contract ?? buildCharacterPromptContract()
  return linesFromContract(resolvedContract).join('\n')
}

function hasImage(image) {
  return Boolean(image?.buffer)
}

function buildTemplateImageGuidance(contract) {
  if (contract.layout_contract.kind === 'fixed_regions') {
    return 'The attached template image is the approved strict pose and layout template, not a style reference and not a character identity reference. Use it as the first reference image for the output structure: replace the placeholder character with the requested subject while keeping its non-uniform fixed-region layout, source action order, region boundaries, body orientation, facing directions, silhouette rhythm, controllable movement semantics, sprite proportion, sprite scale, spacing, canvas size, canvas ratio, sprite sheet layout, pixel art style, and feet-center anchor logic. Do not copy the placeholder character, creature type, colors, costume, or facial features from the template.'
  }
  return 'The attached template image is the approved strict structural 8x8 layout template, not a style reference and not a character identity reference. Preserve only its uniform 8 columns x 8 rows layout, 64 equal cell slots, row order, column order, action timing, direction order, pose logic, sprite scale, spacing, padding, and feet-center anchor logic. Do not copy empty template cells: empty-looking template slots are placeholders that must be replaced with complete character poses in the same row and column slot. If the template contains missing cells, cropped placeholder art, tan padding, wide gaps, or uneven columns, the written topdown row/column map is authoritative. Do not reinterpret it as a non-uniform motion sheet. Do not copy the placeholder character, creature type, colors, costume, or facial features from the template.'
}

export function compileProviderPrompt({ contract, templateImage, referenceImage, paletteImage } = {}) {
  const resolvedContract = contract ?? buildCharacterPromptContract()
  const basePrompt = compileCharacterPromptContract(resolvedContract)
  if (!hasImage(templateImage) && !hasImage(referenceImage) && !hasImage(paletteImage)) return basePrompt

  const imageGuidance = [
    'The written layout contract and structural template override all reference and palette images. Reference images must not override layout, frame count, cell boundaries, or fixed-region positions.',
    hasImage(templateImage) ? buildTemplateImageGuidance(resolvedContract) : '',
    hasImage(referenceImage)
      ? 'The optional second attached image is a weak appearance reference. Use only broad silhouette, palette family, and outline finish that are compatible with the written character description. DO NOT copy character content from it: hair color, exact hairstyle, clothing color, clothing design, fabric type, weapons, shields, items, held objects, facial features, skin color, body details, scenery, or props unless explicitly requested in the written character description.'
      : '',
    hasImage(paletteImage)
      ? 'The optional palette/style image is a palette/style reference only. Match only its color palette, ramp relationships, saturation range, and outline weight. DO NOT copy character content, objects, UI, labels, layout, composition, scenery, props, weapons, shields, tools, or held items from the palette/style image.'
      : '',
  ].filter(Boolean)

  return `${basePrompt}\n${imageGuidance.join('\n')}`
}

export function summarizePromptContract(contract) {
  const resolvedContract = contract ?? buildCharacterPromptContract()
  return {
    schema_version: resolvedContract.schema_version,
    contract_version: resolvedContract.contract_version,
    t2i_mode: resolvedContract.t2i_mode ?? TEXT_TO_IMAGE_MODE_PRODUCTION_SHEET,
    preset: resolvedContract.preset,
    subject: resolvedContract.subject,
    structured_subject: resolvedContract.structured_subject,
    character_preset: resolvedContract.character_preset ?? null,
    prompt_fields: resolvedContract.prompt_fields ?? {},
    background_mode: resolvedContract.background_contract?.mode ?? 'auto',
    layout_id: resolvedContract.layout_contract.id,
    layout_kind: resolvedContract.layout_contract.kind,
    validation_expectations: [...resolvedContract.validation_contract.expectations],
  }
}
