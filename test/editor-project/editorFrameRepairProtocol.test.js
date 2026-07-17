import test from 'node:test'
import assert from 'node:assert/strict'

import * as editorProject from '../../src/editor-project/index.js'
import {
  FrameRepairError,
  assertFrameRepairAcceptRequest,
  assertFrameRepairLiveRequest,
  assertFrameRepairPlanRequest,
  isFrameRepairOperationId,
} from '../../src/editor-project/frameRepairProtocol.js'

function planRequest(overrides = {}) {
  return {
    expectedRevision: 4,
    expectedAssetRevisionId: 'rev_003',
    clipId: 'walk_down',
    clipFramePosition: 1,
    sheetFrameIndex: 17,
    instruction: 'repair the left hand',
    maskEdits: [
      { op: 'add_rectangle', x: 10, y: 12, width: 8, height: 9 },
      { op: 'remove_rectangle', x: 12, y: 14, width: 2, height: 3 },
    ],
    providerPresetId: 'gemini-default',
    imageConfig: { image_size: '1K' },
    ...overrides,
  }
}

function liveRequest(overrides = {}) {
  return {
    ...planRequest(),
    operationId: 'fr_0123456789abcdef',
    expectedPlanHash: 'a'.repeat(64),
    confirmLiveGeneration: true,
    maxProviderCalls: 1,
    ...overrides,
  }
}

function acceptRequest(overrides = {}) {
  return {
    expectedRevision: 4,
    expectedAssetRevisionId: 'rev_003',
    expectedPlanHash: 'a'.repeat(64),
    warningConfirmed: false,
    ...overrides,
  }
}

function captureError(fn, code) {
  let captured
  assert.throws(fn, (error) => {
    assert.equal(error instanceof FrameRepairError, true)
    assert.equal(error.code, code)
    captured = error
    return true
  })
  return captured
}

function assertCode(fn, code) {
  captureError(fn, code)
}

function assertErrorDoesNotEcho(error, values) {
  const serialized = JSON.stringify({
    name: error.name,
    message: error.message,
    code: error.code,
    details: error.details,
  })
  for (const value of values) {
    assert.equal(serialized.includes(value), false)
    assert.equal(error.message.includes(value), false)
    assert.equal(JSON.stringify(error.details).includes(value), false)
  }
}

test('Frame Repair validators are public exports and accept the exact approved envelopes', () => {
  assert.equal(editorProject.assertFrameRepairPlanRequest, assertFrameRepairPlanRequest)
  assert.equal(editorProject.assertFrameRepairLiveRequest, assertFrameRepairLiveRequest)
  assert.equal(editorProject.assertFrameRepairAcceptRequest, assertFrameRepairAcceptRequest)
  assert.equal(editorProject.isFrameRepairOperationId, isFrameRepairOperationId)

  const plan = planRequest()
  const live = liveRequest()
  const accept = acceptRequest()
  assert.deepEqual(assertFrameRepairPlanRequest(plan), plan)
  assert.deepEqual(assertFrameRepairLiveRequest(live), live)
  assert.deepEqual(assertFrameRepairAcceptRequest(accept), accept)
  assert.deepEqual(assertFrameRepairAcceptRequest(acceptRequest({ warningConfirmed: true })), {
    ...accept,
    warningConfirmed: true,
  })
  assert.deepEqual(assertFrameRepairPlanRequest(planRequest({ imageConfig: { image_size: '2K' } })).imageConfig, {
    image_size: '2K',
  })
})

test('Frame Repair validators return detached deep plain clones and normalize instruction NFC', () => {
  const input = planRequest({ instruction: '  re\u0065\u0301pair hand  ' })
  const result = assertFrameRepairPlanRequest(input)

  assert.equal(result.instruction, 're\u00e9pair hand')
  assert.notEqual(result, input)
  assert.notEqual(result.maskEdits, input.maskEdits)
  assert.notEqual(result.maskEdits[0], input.maskEdits[0])
  assert.notEqual(result.imageConfig, input.imageConfig)

  result.maskEdits[0].x = 999
  result.imageConfig.image_size = '2K'
  input.maskEdits[1].height = 99
  assert.equal(input.maskEdits[0].x, 10)
  assert.equal(input.imageConfig.image_size, '1K')
  assert.equal(result.maskEdits[1].height, 3)

  const live = liveRequest()
  const liveResult = assertFrameRepairLiveRequest(live)
  liveResult.maskEdits[0].width = 99
  assert.equal(live.maskEdits[0].width, 8)
})

test('Frame Repair envelopes reject aliases and unexpected top-level or nested fields', () => {
  for (const request of [
    { ...planRequest(), expected_revision: 4 },
    { ...planRequest(), expectedAssetRevisionId: undefined, expected_asset_revision_id: 'rev_003' },
    { ...planRequest(), extra: true },
  ]) assertCode(() => assertFrameRepairPlanRequest(request), 'unexpected_request_field')

  assertCode(
    () => assertFrameRepairPlanRequest(planRequest({
      maskEdits: [{ op: 'add_rectangle', x: 0, y: 0, width: 1, height: 1, color: 'red' }],
    })),
    'unexpected_request_field',
  )
  assertCode(
    () => assertFrameRepairPlanRequest(planRequest({ imageConfig: { image_size: '1K', aspect_ratio: '1:1' } })),
    'unexpected_request_field',
  )
  assertCode(() => assertFrameRepairLiveRequest({ ...liveRequest(), max_provider_calls: 1 }), 'unexpected_request_field')
  assertCode(
    () => assertFrameRepairLiveRequest(liveRequest({
      imageConfig: { image_size: '1K', apiKey: 'secret-value' },
    })),
    'unexpected_request_field',
  )
  assertCode(() => assertFrameRepairAcceptRequest({ ...acceptRequest(), expected_plan_hash: 'a'.repeat(64) }), 'unexpected_request_field')
})

test('Frame Repair unexpected-field errors never echo attacker-controlled key names or values', () => {
  const sensitiveKey = '../../workspace/private/sk-abcdefghijklmnop'
  const sensitiveValue = 'Bearer abcdefghijklmnop'
  const request = planRequest()
  request[sensitiveKey] = sensitiveValue

  const error = captureError(
    () => assertFrameRepairPlanRequest(request),
    'unexpected_request_field',
  )
  assertErrorDoesNotEcho(error, [sensitiveKey, sensitiveValue])
})

test('Frame Repair envelopes reject non-plain bodies and missing required fields', () => {
  for (const request of [null, [], 'request', new Date()]) {
    assertCode(() => assertFrameRepairPlanRequest(request), 'invalid_frame_repair_request')
  }
  const inherited = Object.assign(Object.create({ inherited: true }), planRequest())
  assertCode(() => assertFrameRepairPlanRequest(inherited), 'invalid_frame_repair_request')

  const missingPlanField = planRequest()
  delete missingPlanField.clipId
  assertCode(() => assertFrameRepairPlanRequest(missingPlanField), 'invalid_frame_repair_request')
  const missingLiveField = liveRequest()
  delete missingLiveField.expectedPlanHash
  assertCode(() => assertFrameRepairLiveRequest(missingLiveField), 'invalid_frame_repair_request')
  const missingAcceptField = acceptRequest()
  delete missingAcceptField.warningConfirmed
  assertCode(() => assertFrameRepairAcceptRequest(missingAcceptField), 'invalid_accept_request')
})

test('Frame Repair plan rejects secret-like values and base64 data URLs', () => {
  for (const instruction of [
    'use Bearer abcdefghijklmnop',
    'use sk-abcdefghijklmnop',
    'data:image/png;base64,AAAA',
  ]) assertCode(
    () => assertFrameRepairPlanRequest(planRequest({ instruction })),
    'invalid_frame_repair_request',
  )

  assertCode(() => assertFrameRepairPlanRequest({ ...planRequest(), apiKey: 'secret-value' }), 'unexpected_request_field')
  assertCode(() => assertFrameRepairLiveRequest({ ...liveRequest(), authorization: 'Bearer abcdefghijklmnop' }), 'unexpected_request_field')
  assertCode(() => assertFrameRepairAcceptRequest({ ...acceptRequest(), source_base64: 'data:image/png;base64,AAAA' }), 'unexpected_request_field')
})

test('Frame Repair rejects parameterized base64 data URLs without echoing the payload', () => {
  const payload = 'data:image/png;charset=utf-8;base64,AAAA'
  const error = captureError(
    () => assertFrameRepairPlanRequest(planRequest({ instruction: payload })),
    'invalid_frame_repair_request',
  )
  assertErrorDoesNotEcho(error, [payload])
})

test('Frame Repair rejects embedded base64 data URLs without echoing the payload', () => {
  const payload = 'data:image/png;base64,AAAA'
  const instruction = `repair hand using ${payload} as reference`
  const error = captureError(
    () => assertFrameRepairPlanRequest(planRequest({ instruction })),
    'invalid_frame_repair_request',
  )
  assertErrorDoesNotEcho(error, [payload, instruction])
})

test('Frame Repair plan rejects invalid revision, asset, clip, frame, and preset identities', () => {
  for (const request of [
    planRequest({ expectedRevision: -1 }),
    planRequest({ expectedRevision: 1.5 }),
    planRequest({ expectedAssetRevisionId: 'REV_003' }),
    planRequest({ expectedAssetRevisionId: '../rev_003' }),
    planRequest({ clipId: 'walk/down' }),
    planRequest({ clipFramePosition: -1 }),
    planRequest({ clipFramePosition: 1.5 }),
    planRequest({ sheetFrameIndex: -1 }),
    planRequest({ sheetFrameIndex: 17.5 }),
    planRequest({ providerPresetId: 'gemini default' }),
  ]) assertCode(() => assertFrameRepairPlanRequest(request), 'invalid_frame_repair_request')
})

test('Frame Repair plan preserves ordered rectangle edits and rejects invalid or excessive edits', () => {
  assert.deepEqual(assertFrameRepairPlanRequest(planRequest()).maskEdits.map(({ op }) => op), [
    'add_rectangle',
    'remove_rectangle',
  ])
  assert.deepEqual(assertFrameRepairPlanRequest(planRequest({ maskEdits: [] })).maskEdits, [])

  const invalidEdits = [
    null,
    { op: 'add', x: 0, y: 0, width: 1, height: 1 },
    { op: 'add_rectangle', x: -1, y: 0, width: 1, height: 1 },
    { op: 'add_rectangle', x: 0.5, y: 0, width: 1, height: 1 },
    { op: 'add_rectangle', x: 0, y: -1, width: 1, height: 1 },
    { op: 'add_rectangle', x: 0, y: 0.5, width: 1, height: 1 },
    { op: 'add_rectangle', x: 0, y: 0, width: 0, height: 1 },
    { op: 'add_rectangle', x: 0, y: 0, width: 1.5, height: 1 },
    { op: 'remove_rectangle', x: 0, y: 0, width: 1, height: 0 },
    { op: 'remove_rectangle', x: 0, y: 0, width: 1, height: 1.5 },
  ]
  for (const edit of invalidEdits) assertCode(
    () => assertFrameRepairPlanRequest(planRequest({ maskEdits: [edit] })),
    'invalid_frame_repair_request',
  )
  assertCode(() => assertFrameRepairPlanRequest(planRequest({ maskEdits: 'none' })), 'invalid_frame_repair_request')
  assertCode(
    () => assertFrameRepairPlanRequest(planRequest({
      maskEdits: Array.from({ length: 65 }, () => ({ op: 'add_rectangle', x: 0, y: 0, width: 1, height: 1 })),
    })),
    'invalid_frame_repair_request',
  )
})

test('Frame Repair plan requires a non-empty control-free instruction of at most 500 Unicode characters', () => {
  assert.equal(assertFrameRepairPlanRequest(planRequest({ instruction: '\ud83d\udee0'.repeat(500) })).instruction, '\ud83d\udee0'.repeat(500))
  for (const instruction of [
    '',
    '   ',
    'line one\nline two',
    'bad\u0000control',
    'bad\u0085control',
    'x'.repeat(501),
    '\ud83d\udee0'.repeat(501),
  ]) assertCode(
    () => assertFrameRepairPlanRequest(planRequest({ instruction })),
    'invalid_frame_repair_request',
  )
})

test('Frame Repair plan accepts only the exact image configuration', () => {
  for (const imageConfig of [
    null,
    [],
    {},
    { image_size: '1k' },
    { image_size: '4K' },
    { imageSize: '1K' },
  ]) assertCode(
    () => assertFrameRepairPlanRequest(planRequest({ imageConfig })),
    imageConfig?.imageSize ? 'unexpected_request_field' : 'invalid_frame_repair_request',
  )
})

test('Frame Repair operation ids enforce the exact public syntax and length bounds', () => {
  for (const value of [
    'a'.repeat(16),
    'A_Z-09'.padEnd(80, 'x'),
    'fr_0123456789abcdef',
  ]) assert.equal(isFrameRepairOperationId(value), true)

  for (const value of [
    null,
    12,
    'a'.repeat(15),
    'a'.repeat(81),
    '../escape________',
    'contains.dot.value',
    'contains space___',
  ]) assert.equal(isFrameRepairOperationId(value), false)
})

test('Frame Repair live rejects invalid operation ids, hashes, confirmations, and provider budgets', () => {
  for (const operationId of ['short', '../escape________', 'a'.repeat(81), 123]) {
    assertCode(() => assertFrameRepairLiveRequest(liveRequest({ operationId })), 'invalid_frame_repair_request')
  }
  for (const expectedPlanHash of [
    'a'.repeat(63),
    'a'.repeat(65),
    'A'.repeat(64),
    'g'.repeat(64),
    123,
  ]) assertCode(
    () => assertFrameRepairLiveRequest(liveRequest({ expectedPlanHash })),
    'invalid_frame_repair_request',
  )
  for (const confirmLiveGeneration of [false, 'true', 1, null]) assertCode(
    () => assertFrameRepairLiveRequest(liveRequest({ confirmLiveGeneration })),
    'invalid_frame_repair_request',
  )
  for (const maxProviderCalls of [0, 2, -1, '1', true, null]) assertCode(
    () => assertFrameRepairLiveRequest(liveRequest({ maxProviderCalls })),
    'invalid_frame_repair_request',
  )
})

test('Frame Repair Accept requires only valid exact identities, hash, and boolean warning confirmation', () => {
  for (const request of [
    acceptRequest({ expectedRevision: -1 }),
    acceptRequest({ expectedRevision: 1.5 }),
    acceptRequest({ expectedAssetRevisionId: 'REV_003' }),
    acceptRequest({ expectedAssetRevisionId: '../rev_003' }),
    acceptRequest({ expectedPlanHash: 'a'.repeat(63) }),
    acceptRequest({ expectedPlanHash: 'A'.repeat(64) }),
    acceptRequest({ expectedPlanHash: 'g'.repeat(64) }),
    acceptRequest({ warningConfirmed: 0 }),
    acceptRequest({ warningConfirmed: 'false' }),
    acceptRequest({ warningConfirmed: null }),
  ]) assertCode(() => assertFrameRepairAcceptRequest(request), 'invalid_accept_request')
})
