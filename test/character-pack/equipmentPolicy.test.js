import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { loadRgba } from '../../src/character-pack/imageCodec.js'
import {
  EQUIPMENT_POLICY,
  equipmentPolicyContract,
  equipmentPromptRules,
  evaluateEquipmentQualityGate,
  normalizeEquipmentPolicy,
} from '../../src/character-pack/equipmentPolicy.js'

const REAL_PIG_TEMPLATE = new URL('../../templates/motion_template_ocad_primary.png', import.meta.url)

function image(width, height) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

function paint(imageValue, rectangle, color = [20, 110, 75, 255]) {
  for (let y = rectangle.y; y < rectangle.y + rectangle.h; y += 1) {
    for (let x = rectangle.x; x < rectangle.x + rectangle.w; x += 1) {
      imageValue.data.set(color, (y * imageValue.width + x) * 4)
    }
  }
}

test('equipment policy normalization and contracts keep body and attachment semantics explicit', () => {
  assert.equal(normalizeEquipmentPolicy(undefined), EQUIPMENT_POLICY.NONE)
  assert.equal(normalizeEquipmentPolicy(' separate '), EQUIPMENT_POLICY.SEPARATE)
  assert.throws(() => normalizeEquipmentPolicy('automatic'))
  assert.deepEqual(equipmentPolicyContract('separate'), {
    policy: 'separate',
    body_layer_equipment_free: true,
    inline_equipment_allowed: false,
    separate_attachment_layer: true,
    automatic_acceptance_allowed: false,
    automatic_retry_allowed: false,
  })
  assert.match(equipmentPromptRules('none').join('\n'), /sword, blade, knife/i)
  assert.match(equipmentPromptRules('none').join('\n'), /final authority/i)
  assert.match(equipmentPromptRules('separate').join('\n'), /separate transparent attachment layer/i)
})

test('provider-free removal evidence fails closed on an unchanged real pig template', async () => {
  const parent = await loadRgba(await readFile(REAL_PIG_TEMPLATE))
  const candidate = {
    width: parent.width,
    height: parent.height,
    data: new Uint8ClampedArray(parent.data),
  }
  const snapshot = new Uint8ClampedArray(candidate.data)
  const gate = evaluateEquipmentQualityGate({
    candidate,
    before: parent,
    template: parent,
    equipmentPolicy: 'none',
    requireRemovalEvidence: true,
  })

  assert.equal(gate.provider_free, true)
  assert.equal(gate.status, 'blocked')
  assert.equal(gate.removal_evidence_required, true)
  assert.equal(gate.policy_checks.changed_pixel_count, 0)
  assert.equal(gate.policy_checks.changed_before_visible_pixel_count, 0)
  assert.equal(gate.policy_checks.removal_observed, false)
  assert.ok(gate.blocking_errors.includes('equipment_gate:removal_not_observed'))
  assert.deepEqual(candidate.data, snapshot)
})

test('action correction uses the pose template as its silhouette envelope while retaining the parent separately', () => {
  const before = image(24, 24)
  paint(before, { x: 9, y: 4, w: 6, h: 16 })
  const template = image(24, 24)
  paint(template, { x: 9, y: 4, w: 6, h: 16 })
  paint(template, { x: 3, y: 10, w: 8, h: 2 })
  const candidate = image(24, 24)
  candidate.data.set(template.data)

  const parentEnvelope = evaluateEquipmentQualityGate({
    candidate,
    before,
    template,
    equipmentPolicy: 'preserve',
  })
  const poseEnvelope = evaluateEquipmentQualityGate({
    candidate,
    before,
    template,
    equipmentPolicy: 'preserve',
    preferTemplateEnvelope: true,
  })

  assert.equal(parentEnvelope.status, 'blocked')
  assert.ok(parentEnvelope.blocking_errors.includes('equipment_gate:silhouette_protrusion'))
  assert.equal(poseEnvelope.status, 'pass')
  assert.equal(poseEnvelope.reference.comparison_source, 'template')
  assert.equal(poseEnvelope.reference.before_available, true)
  assert.equal(poseEnvelope.reference.template_envelope_preferred, true)
})
