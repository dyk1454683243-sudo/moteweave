import assert from 'node:assert/strict'
import test from 'node:test'

import {
  analyzeSubjectCountCell,
  evaluateSubjectCountCells,
} from '../../src/character-pack/subjectCountGate.js'

function image(width = 96, height = 96) {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) }
}

function paint(target, rect, color = [70, 120, 190, 255]) {
  for (let y = rect.y; y < rect.y + rect.h; y += 1) {
    for (let x = rect.x; x < rect.x + rect.w; x += 1) {
      const offset = (y * target.width + x) * 4
      target.data.set(color, offset)
    }
  }
}

function baseSubject() {
  const target = image()
  paint(target, { x: 34, y: 20, w: 24, h: 60 })
  return target
}

test('subject-count gate passes one subject and does not mutate input pixels', () => {
  const target = baseSubject()
  const before = Buffer.from(target.data)
  const result = analyzeSubjectCountCell(target, { region_key: 'idle_0' })

  assert.equal(result.status, 'pass')
  assert.equal(result.components.length, 1)
  assert.equal(result.components[0].classification, 'main')
  assert.equal(result.input_pixels_sha256, result.output_pixels_sha256)
  assert.deepEqual(Buffer.from(target.data), before)
})

test('subject-count gate treats a detached thin sword as an accessory advisory', () => {
  const target = baseSubject()
  paint(target, { x: 92, y: 30, w: 2, h: 48 }, [170, 170, 190, 255])
  const result = analyzeSubjectCountCell(target, { region_key: 'attack_0' })

  assert.equal(result.status, 'pass')
  assert.equal(result.components[1].classification, 'accessory')
  assert.equal(result.accessory_edge_contact, false)

  paint(target, { x: 95, y: 30, w: 1, h: 48 }, [170, 170, 190, 255])
  const edgeResult = analyzeSubjectCountCell(target, { region_key: 'attack_0' })
  assert.equal(edgeResult.status, 'pass')
  assert.equal(edgeResult.accessory_edge_contact, true)
})

test('subject-count gate treats a detached diagonal low-fill weapon as equipment', () => {
  const target = baseSubject()
  for (let y = 24; y < 76; y += 1) {
    const x = 2 + Math.floor((y - 24) / 4)
    paint(target, { x, y, w: 5, h: 1 }, [170, 170, 190, 255])
  }

  const result = analyzeSubjectCountCell(target, { region_key: 'attack_0' })

  assert.equal(result.components[1].area_ratio_to_main >= 0.18, true)
  assert.equal(result.status, 'pass')
  assert.equal(result.components[1].classification, 'accessory')
})

test('subject-count gate blocks a second body-scale subject', () => {
  const target = baseSubject()
  paint(target, { x: 4, y: 25, w: 20, h: 52 }, [180, 90, 80, 255])
  const result = analyzeSubjectCountCell(target, { region_key: 'attractL4' })

  assert.equal(result.status, 'blocked')
  assert.equal(result.components[1].classification, 'second_subject')
  assert.ok(result.reason_codes.includes('multiple_subjects_high_confidence'))
})

test('subject-count gate sends uncertain body fragments to review and keeps empty distinct', () => {
  const partial = baseSubject()
  paint(partial, { x: 4, y: 38, w: 10, h: 34 }, [180, 90, 80, 255])
  const suspicious = analyzeSubjectCountCell(partial, { region_key: 'attractL6' })
  assert.equal(suspicious.status, 'needs_review')
  assert.equal(suspicious.components[1].classification, 'suspicious')

  const empty = analyzeSubjectCountCell(image(), { region_key: 'empty_0' })
  assert.equal(empty.status, 'empty')
  assert.equal(empty.components.length, 0)
})

test('subject-count report suggests only blocked region keys and records accessory advisories', () => {
  const pass = baseSubject()
  const blocked = baseSubject()
  paint(blocked, { x: 4, y: 25, w: 20, h: 52 })
  const accessory = baseSubject()
  paint(accessory, { x: 95, y: 30, w: 1, h: 48 })
  const canvas = image(288, 96)
  const result = evaluateSubjectCountCells([
    { image: pass, rect: { x: 0, y: 0, w: 96, h: 96 }, region_key: 'walk0', action: 'walk' },
    { image: blocked, rect: { x: 96, y: 0, w: 96, h: 96 }, region_key: 'attractL4', action: 'attractL' },
    { image: accessory, rect: { x: 192, y: 0, w: 96, h: 96 }, region_key: 'attack0', action: 'attack' },
  ], { canvas, stage: 'normalized_frames', sourceLayoutId: 'topdown_rpg_v0' })

  assert.equal(result.report.status, 'blocked')
  assert.deepEqual(result.report.suggested_region_keys, ['attractL4'])
  assert.deepEqual(result.report.advisory_region_keys, ['attack0'])
  assert.ok(result.overlay)
})

test('connected thin equipment does not become a second subject but a connected second body does', () => {
  const sword = baseSubject()
  paint(sword, { x: 58, y: 48, w: 38, h: 2 }, [170, 170, 190, 255])
  const connectedBodies = baseSubject()
  paint(connectedBodies, { x: 60, y: 20, w: 24, h: 60 }, [180, 90, 80, 255])
  paint(connectedBodies, { x: 58, y: 48, w: 2, h: 4 }, [180, 90, 80, 255])

  const result = evaluateSubjectCountCells([
    { image: baseSubject(), region_key: 'attack0', action: 'attack' },
    { image: baseSubject(), region_key: 'attack1', action: 'attack' },
    { image: sword, region_key: 'attack2', action: 'attack' },
    { image: baseSubject(), region_key: 'crowd0', action: 'crowd' },
    { image: baseSubject(), region_key: 'crowd1', action: 'crowd' },
    { image: connectedBodies, region_key: 'crowd2', action: 'crowd' },
  ], { stage: 'normalized_frames', sourceLayoutId: 'topdown_rpg_v0' })

  const swordCell = result.report.cells.find((cell) => cell.region_key === 'attack2')
  const crowdCell = result.report.cells.find((cell) => cell.region_key === 'crowd2')
  assert.equal(swordCell.status, 'pass')
  assert.equal(crowdCell.status, 'blocked')
  assert.ok(crowdCell.reason_codes.includes('connected_multiple_subjects_high_confidence'))
})
