import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildCharacterPromptContract,
  compileCharacterPromptContract,
  compileProviderPrompt,
  PROMPT_CONTRACT_VERSION,
} from '../../src/character-pack/promptContracts.js'
import {
  FIXED_REGION_MOTION_LAYOUT_ID,
  LEGACY_OCAD_MOTION_LAYOUT_ID,
} from '../../src/character-pack/sourceLayouts.js'

test('topdown prompt contract keeps the 8x8 layout protocol isolated', () => {
  const contract = buildCharacterPromptContract({ description: 'silver swordswoman', preset: 'topdown_rpg_v0' })
  const prompt = compileCharacterPromptContract(contract)

  assert.equal(contract.contract_version, PROMPT_CONTRACT_VERSION)
  assert.equal(contract.contract_version, 'character_prompt_contract_v1_15')
  assert.equal(contract.preset, 'topdown_rpg_v0')
  assert.equal(contract.layout_contract.kind, 'uniform_grid')
  assert.ok(contract.validation_contract.expectations.includes('no_empty_cells'))
  assert.ok(contract.validation_contract.expectations.includes('no_cropped_or_edge_cut_character'))
  assert.ok(contract.validation_contract.expectations.includes('layout_template_has_priority_over_reference_images'))
  assert.ok(contract.validation_contract.expectations.includes('compact_horizontal_attack_rows'))
  assert.match(prompt, /exactly 8 columns by 8 rows/i)
  assert.match(prompt, /exactly 64 cells total/i)
  assert.match(prompt, /Every required cell must contain one visible complete character pose/i)
  assert.match(prompt, /no cell may be blank, empty, white-only, transparent-only, or background-only/i)
  assert.match(prompt, /Do not use a one-image fixed-region motion layout/i)
  assert.match(prompt, /Rows: idle down\/up, idle left\/right/i)
  assert.match(prompt, /Each row is split into two required 4-frame animation segments/i)
  assert.match(prompt, /row 0 columns 4-7 = idle up/i)
  assert.match(prompt, /row 1 columns 4-7 = idle right/i)
  assert.match(prompt, /If the attached template has empty-looking cells/i)
  assert.match(prompt, /the output must still fill those cells/i)
  assert.match(prompt, /Frames 40-43 \(attack left\) and 44-47 \(attack right\)/i)
  assert.match(prompt, /weapons, staffs, shields, tools, capes, spell effects, and stretched arms compact/i)
  assert.doesNotMatch(prompt, /non-uniform fixed-region/i)
  assert.doesNotMatch(prompt, /idledown/i)
  assert.doesNotMatch(prompt, /attractL/i)
})

test('fixed-region motion prompt contract keeps source semantics isolated', () => {
  const contract = buildCharacterPromptContract({ description: 'green ranger', preset: FIXED_REGION_MOTION_LAYOUT_ID })
  const prompt = compileCharacterPromptContract(contract)

  assert.equal(contract.contract_version, 'character_prompt_contract_v1_15')
  assert.equal(contract.preset, FIXED_REGION_MOTION_LAYOUT_ID)
  assert.equal(contract.layout_contract.kind, 'fixed_regions')
  assert.ok(contract.validation_contract.expectations.includes('no_empty_cells'))
  assert.ok(contract.validation_contract.expectations.includes('manual_fixed_region_direction_consistency'))
  assert.ok(contract.validation_contract.expectations.includes('manual_fixed_region_action_boundary_review'))
  assert.match(prompt, /one square sprite sheet image/i)
  assert.match(prompt, /fixed-region motion source layout/i)
  assert.match(prompt, /first attached template image as the structural template/i)
  assert.match(prompt, /format, region placement, action order/i)
  assert.match(prompt, /body orientation, facing direction, silhouette rhythm/i)
  assert.match(prompt, /sprite proportion, sprite scale, spacing, canvas size, canvas ratio/i)
  assert.match(prompt, /sprite sheet layout, pixel art style/i)
  assert.match(prompt, /Replace only the placeholder character/i)
  assert.match(prompt, /If more than one template image is attached/i)
  assert.match(prompt, /Do not target a literal tiny pixel canvas/i)
  assert.match(prompt, /local post-processing can hard-scale/i)
  assert.match(prompt, /Every required fixed region should contain one complete readable character pose/i)
  assert.match(prompt, /Do not convert this layout into an 8x8 grid/i)
  assert.match(prompt, /idledown/i)
  assert.match(prompt, /attractL/i)
  assert.match(prompt, /Replace every template pose one-for-one in its original fixed region/i)
  assert.match(prompt, /walkdown, and rundown face toward the viewer/i)
  assert.match(prompt, /walkup, and runup face away from the viewer/i)
  assert.match(prompt, /walkL, runL, and attractL face screen-left/i)
  assert.match(prompt, /keep one camera view and one facing direction across the entire action/i)
  assert.match(prompt, /Do not mix walk, run, idle, climb, defence/i)
  assert.match(prompt, /All six climb regions must keep one consistent climb-facing view/i)
  assert.match(prompt, /fixed regions and their action ownership in the template are authoritative/i)
  assert.match(prompt, /Default to empty hands/i)
  assert.match(prompt, /do not add ladders, weapons, shields, tools, props/i)
  assert.match(prompt, /one clean character silhouette/i)
  assert.match(prompt, /no extra or duplicated arms or hands/i)
  assert.match(prompt, /ghost limbs, motion blur, action trails, afterimages/i)
  assert.match(prompt, /summoned limbs, copied effects, signature powers, or extra anatomy/i)
  assert.match(prompt, /Show motion across frames or regions/i)
  assert.match(prompt, /not as multiple limb positions inside one cell or region/i)
  assert.match(prompt, /Do not include text, numbers, labels, UI/i)
  assert.match(prompt, /Static single-region actions remain single source poses/i)
  assert.match(prompt, /multi-region actions should show readable phase changes/i)
  assert.doesNotMatch(prompt, /single clean anatomy exposure/i)
  assert.doesNotMatch(prompt, /Show motion by changing the pose between numbered source regions/i)
  assert.doesNotMatch(prompt, /Do not draw held weapons, shields, tools, props/i)
  assert.doesNotMatch(prompt, /Do not try to draw internal mini-frame strips inside a single fixed region/i)
  assert.doesNotMatch(prompt, /right-facing runtime frames are synthesized/i)
  assert.doesNotMatch(prompt, /OCAD/i)
  assert.doesNotMatch(prompt, /exactly 8 columns by 8 rows/i)
  assert.doesNotMatch(prompt, /Rows: idle down\/up/i)
  assert.doesNotMatch(prompt, /exactly 64 cells total/i)
})

test('fixed-region motion prompt contract accepts the legacy preset as an alias', () => {
  const contract = buildCharacterPromptContract({ description: 'green ranger', preset: LEGACY_OCAD_MOTION_LAYOUT_ID })

  assert.equal(contract.preset, FIXED_REGION_MOTION_LAYOUT_ID)
  assert.equal(contract.layout_contract.id, FIXED_REGION_MOTION_LAYOUT_ID)
})

test('provider prompt compilation adds image guidance without changing the base contract', () => {
  const contract = buildCharacterPromptContract({ description: 'blue wizard', preset: 'topdown_rpg_v0' })
  const prompt = compileProviderPrompt({
    contract,
    templateImage: { buffer: Buffer.from('template') },
    referenceImage: { buffer: Buffer.from('reference') },
    paletteImage: { buffer: Buffer.from('palette') },
  })

  assert.match(prompt, /strict structural 8x8 layout template/i)
  assert.match(prompt, /Do not copy empty template cells/i)
  assert.match(prompt, /empty-looking template slots are placeholders that must be replaced/i)
  assert.match(prompt, /weak appearance reference/i)
  assert.match(prompt, /palette\/style reference only/i)
  assert.match(prompt, /written layout contract and structural template override all reference and palette images/i)
  assert.match(prompt, /reference images must not override layout/i)
  assert.equal(contract.subject, 'blue wizard')
})
