import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import * as publicEditorProjectApi from '../../src/editor-project/index.js';
import {
  FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS,
  FrameRepairQualityGateError,
  QUALITY_GATE_DEFECT_CATEGORIES,
  QUALITY_GATE_DIFFICULTIES,
  QUALITY_GATE_OUTCOMES,
  QUALITY_GATE_REASON_CODES,
  assertQualityGateFinalizeRequest,
  assertQualityGateOutcomeRequest,
  assertQualityGatePlanRequest,
  assertQualityGateReviewRequest,
  assertQualityGateRouteIds,
  assertQualityGateSetupRequest,
  assertQualityGateStartRequest,
} from '../../src/editor-project/frameRepairQualityGateProtocol.js';

const REAL_CASES = [
  { caseId: 'case_shape_01', assetId: 'asset_shape_01', expectedAssetRevisionId: 'rev_001', clipId: 'walk_down', clipFramePosition: 0, sheetFrameIndex: 16, instruction: 'Repair the distorted body shape only.', maskEdits: [{ op: 'add_rectangle', x: 20, y: 18, width: 48, height: 62 }], difficulty: 'medium', defectCategory: 'shape', expectedImprovement: 'The body shape is coherent while pixels outside the mask remain unchanged.' },
  { caseId: 'case_detail_01', assetId: 'asset_detail_01', expectedAssetRevisionId: 'rev_001', clipId: 'walk_left', clipFramePosition: 1, sheetFrameIndex: 21, instruction: 'Repair the missing sprite detail only.', maskEdits: [{ op: 'add_rectangle', x: 42, y: 30, width: 16, height: 18 }], difficulty: 'medium', defectCategory: 'detail', expectedImprovement: 'The missing detail is restored without altering unrelated pixels.' },
  { caseId: 'case_anchor_01', assetId: 'asset_anchor_01', expectedAssetRevisionId: 'rev_001', clipId: 'walk_up', clipFramePosition: 2, sheetFrameIndex: 10, instruction: 'Repair the foot anchor and baseline only.', maskEdits: [{ op: 'add_rectangle', x: 28, y: 70, width: 40, height: 18 }], difficulty: 'medium', defectCategory: 'anchor_baseline', expectedImprovement: 'The feet share the intended baseline and anchor.' },
  { caseId: 'case_facing_01', assetId: 'asset_facing_01', expectedAssetRevisionId: 'rev_001', clipId: 'walk_right', clipFramePosition: 3, sheetFrameIndex: 31, instruction: 'Repair facing-direction inconsistency only.', maskEdits: [{ op: 'add_rectangle', x: 18, y: 14, width: 58, height: 68 }], difficulty: 'medium', defectCategory: 'facing_consistency', expectedImprovement: 'The frame faces right consistently with its neighboring frames.' },
  { caseId: 'case_semantic_01', assetId: 'asset_semantic_01', expectedAssetRevisionId: 'rev_001', clipId: 'idle_down', clipFramePosition: 0, sheetFrameIndex: 0, instruction: 'Reconstruct the masked semantic feature only.', maskEdits: [{ op: 'add_rectangle', x: 30, y: 20, width: 36, height: 44 }], difficulty: 'hard', defectCategory: 'semantic_reconstruction', expectedImprovement: 'The intended feature is recognizable and preserves character identity.' },
  { caseId: 'case_continuity_01', assetId: 'asset_continuity_01', expectedAssetRevisionId: 'rev_001', clipId: 'walk_down', clipFramePosition: 2, sheetFrameIndex: 18, instruction: 'Repair continuity with neighboring animation frames only.', maskEdits: [{ op: 'add_rectangle', x: 22, y: 16, width: 52, height: 66 }], difficulty: 'hard', defectCategory: 'neighbor_continuity', expectedImprovement: 'The repaired frame transitions coherently to both neighboring frames.' },
];

const setup = {
  expectedRevision: 12,
  targetProjectId: 'project_frame_repair_gate_20260712',
  targetProjectName: 'Frame Repair Quality Gate 2026-07-12',
  ownershipConfirmed: true,
  sourceAssets: REAL_CASES.map(({ caseId, assetId, expectedAssetRevisionId }) => ({
    caseId, assetId, expectedAssetRevisionId,
  })),
};
const plan = {
  sessionId: 'frqg_20260712_primary',
  expectedRevision: 1,
  setupManifestSha256: 'a'.repeat(64),
  providerPresetId: 'preset_primary',
  imageConfig: { image_size: '1K' },
  maxProviderCalls: 8,
  cases: [...FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS, ...REAL_CASES],
};
const start = {
  ...plan,
  expectedPlanHash: 'b'.repeat(64),
  confirmSessionStart: true,
};
const review = {
  expectedPlanHash: 'b'.repeat(64),
  expectedCaseHash: 'c'.repeat(64),
  operationId: 'frqgop_0123456789abcdef',
  jobId: 'frame_repair_job_001',
  blindChoice: 'prefer_b',
  improvement: 'improved',
  usability: 'usable',
  newBlockingDefect: false,
  reasonCodes: ['outline_repaired'],
  note: 'cafe\u0301',
};
const outcome = {
  expectedPlanHash: 'b'.repeat(64),
  expectedCaseHash: 'c'.repeat(64),
  operationId: 'frqgop_0123456789abcdef',
  jobId: 'frame_repair_job_001',
  expectedReviewSha256: 'd'.repeat(64),
  outcome: 'accepted',
  expectedProjectRevision: 2,
  acceptedRevisionId: 'rev_002',
};
const finalize = {
  expectedPlanHash: 'b'.repeat(64),
  expectedRevision: 4,
  confirmFinalize: true,
};
const routeIds = {
  projectId: 'project_001',
  sessionId: 'frqg_20260712_primary',
  caseId: 'case_shape_01',
};
const replacePlanCase = (index, patch) => ({
  ...structuredClone(plan),
  cases: plan.cases.map((item, itemIndex) => (
    itemIndex === index ? { ...structuredClone(item), ...patch } : structuredClone(item)
  )),
});
const omitKey = (record, omittedKey) => Object.fromEntries(
  Object.entries(record).filter(([key]) => key !== omittedKey),
);

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};
const assertDetachedDeepFrozen = (actual, input) => {
  assert.equal(Object.isFrozen(actual), true);
  assert.notStrictEqual(actual, input);
  for (const [key, child] of Object.entries(actual)) {
    if (child && typeof child === 'object') assertDetachedDeepFrozen(child, input[key]);
  }
};
const assertDeepFrozen = (value) => {
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') assertDeepFrozen(child);
  }
};

test('publishes the exact frozen vocabulary and control-case defaults', () => {
  assert.deepEqual(QUALITY_GATE_DIFFICULTIES, ['basic', 'medium', 'hard']);
  assert.deepEqual(QUALITY_GATE_DEFECT_CATEGORIES, [
    'outline_alpha_edge', 'small_component', 'shape', 'detail', 'anchor_baseline',
    'facing_consistency', 'semantic_reconstruction', 'neighbor_continuity',
  ]);
  assert.deepEqual(QUALITY_GATE_OUTCOMES, [
    'accepted', 'rejected', 'provider_blocked', 'outcome_unknown', 'quality_blocked',
  ]);
  assert.deepEqual(QUALITY_GATE_REASON_CODES, [
    'outline_repaired', 'alpha_edge_repaired', 'component_repaired', 'shape_improved',
    'detail_improved', 'anchor_improved', 'facing_improved', 'semantic_improved',
    'continuity_improved', 'no_visible_improvement', 'new_artifact', 'identity_drift',
    'pose_drift', 'continuity_regression', 'blocked_by_hard_gate',
  ]);
  assert.deepEqual(FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS, [
    { caseId: 'control_outline_alpha', assetId: 'asset_qg_control_outline_alpha', expectedAssetRevisionId: 'rev_001', clipId: 'walk_down', clipFramePosition: 1, sheetFrameIndex: 17, instruction: 'Repair the broken outline and alpha edge only.', maskEdits: [{ op: 'add_rectangle', x: 39, y: 48, width: 12, height: 18 }], difficulty: 'basic', defectCategory: 'outline_alpha_edge', expectedImprovement: 'The silhouette edge is continuous without changing pixels outside the mask.' },
    { caseId: 'control_small_component', assetId: 'asset_qg_control_small_component', expectedAssetRevisionId: 'rev_001', clipId: 'walk_right', clipFramePosition: 2, sheetFrameIndex: 30, instruction: 'Repair the detached small component only.', maskEdits: [{ op: 'add_rectangle', x: 58, y: 56, width: 10, height: 12 }], difficulty: 'basic', defectCategory: 'small_component', expectedImprovement: 'The detached component is restored to a coherent silhouette without outside-mask changes.' },
  ]);
  for (const constant of [
    QUALITY_GATE_DIFFICULTIES, QUALITY_GATE_DEFECT_CATEGORIES, QUALITY_GATE_OUTCOMES,
    QUALITY_GATE_REASON_CODES, FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS,
  ]) assertDeepFrozen(constant);

  const directExports = {
    FrameRepairQualityGateError,
    QUALITY_GATE_DIFFICULTIES,
    QUALITY_GATE_DEFECT_CATEGORIES,
    QUALITY_GATE_OUTCOMES,
    QUALITY_GATE_REASON_CODES,
    FRAME_REPAIR_QUALITY_GATE_CONTROL_CASE_DEFAULTS,
    assertQualityGateSetupRequest,
    assertQualityGatePlanRequest,
    assertQualityGateStartRequest,
    assertQualityGateReviewRequest,
    assertQualityGateOutcomeRequest,
    assertQualityGateFinalizeRequest,
    assertQualityGateRouteIds,
  };
  for (const [name, directExport] of Object.entries(directExports)) {
    assert.strictEqual(publicEditorProjectApi[name], directExport, `public export ${name}`);
  }
});

test('FrameRepairQualityGateError preserves its public contract', () => {
  const details = { field_count: 2 };
  const error = new FrameRepairQualityGateError(
    'invalid_quality_gate_request',
    'quality gate request is invalid',
    details,
  );
  assert.equal(error.name, 'FrameRepairQualityGateError');
  assert.equal(error.message, 'quality gate request is invalid');
  assert.equal(error.code, 'invalid_quality_gate_request');
  assert.strictEqual(error.details, details);
});

test('all seven validators accept exact envelopes and return frozen detached values', () => {
  const cases = [
    [assertQualityGateSetupRequest, setup, setup],
    [assertQualityGatePlanRequest, plan, plan],
    [assertQualityGateStartRequest, start, start],
    [assertQualityGateReviewRequest, review, { ...review, note: 'caf\u00e9' }],
    [assertQualityGateOutcomeRequest, outcome, outcome],
    [assertQualityGateFinalizeRequest, finalize, finalize],
    [assertQualityGateRouteIds, routeIds, routeIds],
  ];
  for (const [validate, fixture, expected] of cases) {
    const input = deepFreeze(structuredClone(fixture));
    const result = validate(input);
    assert.deepEqual(result, expected);
    assertDetachedDeepFrozen(result, input);
  }

  const nullableRouteInput = deepFreeze({
    projectId: 'project_001', sessionId: null, caseId: null,
  });
  const nullableRouteResult = assertQualityGateRouteIds(nullableRouteInput);
  assert.deepEqual(nullableRouteResult, {
    projectId: 'project_001', sessionId: null, caseId: null,
  });
  assertDetachedDeepFrozen(nullableRouteResult, nullableRouteInput);
});

test('accepts the complete documented outcome nullability matrix', () => {
  const validOutcomes = [
    outcome,
    { ...outcome, outcome: 'rejected', acceptedRevisionId: null },
    {
      ...outcome,
      outcome: 'quality_blocked',
      expectedReviewSha256: null,
      acceptedRevisionId: null,
    },
    {
      ...outcome,
      outcome: 'provider_blocked',
      jobId: null,
      expectedReviewSha256: null,
      acceptedRevisionId: null,
    },
    {
      ...outcome,
      outcome: 'provider_blocked',
      expectedReviewSha256: null,
      acceptedRevisionId: null,
    },
    {
      ...outcome,
      outcome: 'outcome_unknown',
      jobId: null,
      expectedReviewSha256: null,
      acceptedRevisionId: null,
    },
  ];
  for (const fixture of validOutcomes) {
    const input = deepFreeze(structuredClone(fixture));
    const result = assertQualityGateOutcomeRequest(input);
    assert.deepEqual(result, fixture);
    assert.equal(result.expectedProjectRevision, 2);
    assertDetachedDeepFrozen(result, input);
  }
});

test('accepts exact text, rectangle, operation, and repository job boundaries', () => {
  for (const fixture of [
    replacePlanCase(0, {
      instruction: '\ud83d\ude00'.repeat(500),
      expectedImprovement: '\ud83d\ude00'.repeat(500),
    }),
    replacePlanCase(0, {
      maskEdits: [{ op: 'remove_rectangle', x: 0, y: 0, width: 96, height: 96 }],
    }),
  ]) {
    assert.deepEqual(assertQualityGatePlanRequest(deepFreeze(structuredClone(fixture))), fixture);
  }

  const targetNameAtLimit = '\ud83d\ude00'.repeat(160);
  const setupAtLimit = { ...setup, targetProjectName: targetNameAtLimit };
  assert.deepEqual(
    assertQualityGateSetupRequest(deepFreeze(structuredClone(setupAtLimit))),
    setupAtLimit,
  );

  for (const operationId of ['a'.repeat(16), 'Z_-'.repeat(26) + 'Z_']) {
    const reviewAtLimit = { ...review, operationId, jobId: 'job.release:001' };
    const outcomeAtLimit = { ...outcome, operationId, jobId: 'job.release:001' };
    assert.deepEqual(
      assertQualityGateReviewRequest(deepFreeze(structuredClone(reviewAtLimit))),
      { ...reviewAtLimit, note: 'caf\u00e9' },
    );
    assert.deepEqual(
      assertQualityGateOutcomeRequest(deepFreeze(structuredClone(outcomeAtLimit))),
      outcomeAtLimit,
    );
  }

  const routeAtLimits = {
    projectId: 'p'.repeat(80),
    sessionId: `frqg_${'s'.repeat(80)}`,
    caseId: 'c'.repeat(64),
  };
  assert.deepEqual(
    assertQualityGateRouteIds(deepFreeze(structuredClone(routeAtLimits))),
    routeAtLimits,
  );
});

test('rejects malformed envelopes without echoing supplied values', () => {
  const duplicateCaseId = replacePlanCase(1, { caseId: plan.cases[0].caseId });
  const duplicateAssetId = replacePlanCase(1, { assetId: plan.cases[0].assetId });
  const outcomeNullabilityErrors = [
    { ...outcome, jobId: null },
    { ...outcome, expectedReviewSha256: null },
    { ...outcome, acceptedRevisionId: null },
    { ...outcome, outcome: 'rejected', jobId: null, acceptedRevisionId: null },
    { ...outcome, outcome: 'rejected', expectedReviewSha256: null, acceptedRevisionId: null },
    { ...outcome, outcome: 'rejected' },
    {
      ...outcome,
      outcome: 'quality_blocked',
      jobId: null,
      expectedReviewSha256: null,
      acceptedRevisionId: null,
    },
    { ...outcome, outcome: 'quality_blocked', acceptedRevisionId: null },
    { ...outcome, outcome: 'quality_blocked', expectedReviewSha256: null },
    {
      ...outcome,
      outcome: 'provider_blocked',
      jobId: null,
      acceptedRevisionId: null,
    },
    {
      ...outcome,
      outcome: 'provider_blocked',
      jobId: null,
      expectedReviewSha256: null,
    },
    {
      ...outcome,
      outcome: 'outcome_unknown',
      expectedReviewSha256: null,
      acceptedRevisionId: null,
    },
    {
      ...outcome,
      outcome: 'outcome_unknown',
      jobId: null,
      acceptedRevisionId: null,
    },
    {
      ...outcome,
      outcome: 'outcome_unknown',
      jobId: null,
      expectedReviewSha256: null,
    },
  ];
  const forbiddenTopLevelKeys = [
    'path', 'file', 'base64', 'providerKey', 'prompt', 'binary', 'retry',
  ];
  const invalidOperationIds = [
    'a'.repeat(15),
    'a'.repeat(81),
    `${'a'.repeat(15)}.`,
    `${'a'.repeat(15)}:`,
  ];
  const topLevelUnknownCases = [
    ['Setup', assertQualityGateSetupRequest, { ...setup, unexpected: true }],
    ['Plan', assertQualityGatePlanRequest, { ...plan, unexpected: true }],
    ['Start', assertQualityGateStartRequest, { ...start, unexpected: true }],
    ['Review', assertQualityGateReviewRequest, { ...review, unexpected: true }],
    ['Outcome', assertQualityGateOutcomeRequest, { ...outcome, unexpected: true }],
    ['Finalize', assertQualityGateFinalizeRequest, { ...finalize, unexpected: true }],
    ['Route', assertQualityGateRouteIds, { ...routeIds, unexpected: true }],
  ];
  const badCases = [
    ...topLevelUnknownCases.map(([name, validate, value]) => [
      `${name} rejects an unexpected top-level key`, validate, value,
    ]),
    ...forbiddenTopLevelKeys.map((key) => [
      `forbidden top-level key ${key}`,
      assertQualityGateSetupRequest,
      { ...setup, [key]: true },
    ]),
    ['Setup requires exactly 6 source assets, not 5', assertQualityGateSetupRequest, {
      ...setup, sourceAssets: setup.sourceAssets.slice(0, 5),
    }],
    ['Setup requires exactly 6 source assets, not 7', assertQualityGateSetupRequest, {
      ...setup,
      sourceAssets: [
        ...setup.sourceAssets,
        {
          caseId: 'case_extra_01',
          assetId: 'asset_extra_01',
          expectedAssetRevisionId: 'rev_001',
        },
      ],
    }],
    ['Setup requires ownership confirmation', assertQualityGateSetupRequest, {
      ...setup, ownershipConfirmed: false,
    }],
    ['Setup rejects duplicate case ids', assertQualityGateSetupRequest, {
      ...setup,
      sourceAssets: setup.sourceAssets.map((item, index) => (
        index === 1 ? { ...item, caseId: setup.sourceAssets[0].caseId } : item
      )),
    }],
    ['Setup rejects duplicate asset ids', assertQualityGateSetupRequest, {
      ...setup,
      sourceAssets: setup.sourceAssets.map((item, index) => (
        index === 1
          ? {
            ...item,
            assetId: setup.sourceAssets[0].assetId,
            expectedAssetRevisionId: 'rev_002',
          }
          : item
      )),
    }],
    ['Setup rejects duplicate asset revision tuples', assertQualityGateSetupRequest, {
      ...setup,
      sourceAssets: setup.sourceAssets.map((item, index) => (
        index === 1 ? { ...setup.sourceAssets[0] } : item
      )),
    }],
    ['Setup rejects an empty target name', assertQualityGateSetupRequest, {
      ...setup, targetProjectName: '   ',
    }],
    ['Setup rejects target-name control characters', assertQualityGateSetupRequest, {
      ...setup, targetProjectName: 'Frame\nRepair',
    }],
    ['Setup rejects a negative expected revision', assertQualityGateSetupRequest, {
      ...setup, expectedRevision: -1,
    }],
    ['Setup rejects an unsafe expected revision', assertQualityGateSetupRequest, {
      ...setup, expectedRevision: Number.MAX_SAFE_INTEGER + 1,
    }],
    ['Setup rejects an overlong target project id', assertQualityGateSetupRequest, {
      ...setup, targetProjectId: 'p'.repeat(81),
    }],
    ['Setup rejects an unsafe source asset id', assertQualityGateSetupRequest, {
      ...setup,
      sourceAssets: setup.sourceAssets.map((item, index) => (
        index === 0 ? { ...item, assetId: '../unsafe_asset' } : item
      )),
    }],
    ['unexpected nested key', assertQualityGateSetupRequest, {
      ...setup,
      sourceAssets: setup.sourceAssets.map((item, index) => (
        index === 0 ? { ...item, unexpected: true } : item
      )),
    }],
    ['Plan case rejects unexpected nested key', assertQualityGatePlanRequest, replacePlanCase(0, {
      unexpected: true,
    })],
    ['Plan imageConfig rejects an unexpected nested key', assertQualityGatePlanRequest, {
      ...plan, imageConfig: { ...plan.imageConfig, unexpected: true },
    }],
    ['Plan mask edit rejects an unexpected nested key', assertQualityGatePlanRequest, replacePlanCase(0, {
      maskEdits: [{ ...plan.cases[0].maskEdits[0], unexpected: true }],
    })],
    ['Start nested plan record rejects an unexpected key', assertQualityGateStartRequest, {
      ...start, imageConfig: { ...start.imageConfig, unexpected: true },
    }],
    ['Plan rejects Start-only key', assertQualityGatePlanRequest, {
      ...plan, expectedPlanHash: 'b'.repeat(64),
    }],
    ['Plan requires exactly 8 cases, not 7', assertQualityGatePlanRequest, {
      ...plan, cases: plan.cases.slice(0, 7),
    }],
    ['Plan requires exactly 8 cases, not 9', assertQualityGatePlanRequest, {
      ...plan,
      cases: [
        ...plan.cases,
        {
          ...structuredClone(REAL_CASES[0]),
          caseId: 'case_extra_01',
          assetId: 'asset_extra_01',
        },
      ],
    }],
    ['Plan maxProviderCalls rejects 7', assertQualityGatePlanRequest, {
      ...plan, maxProviderCalls: 7,
    }],
    ['Plan maxProviderCalls rejects 9', assertQualityGatePlanRequest, {
      ...plan, maxProviderCalls: 9,
    }],
    ['Plan rejects an unsupported image size', assertQualityGatePlanRequest, {
      ...plan, imageConfig: { image_size: '4K' },
    }],
    ['Plan rejects clip frame position -1', assertQualityGatePlanRequest, replacePlanCase(0, {
      clipFramePosition: -1,
    })],
    ['Plan rejects clip frame position 8', assertQualityGatePlanRequest, replacePlanCase(0, {
      clipFramePosition: 8,
    })],
    ['Plan rejects an unsafe clip frame position', assertQualityGatePlanRequest, replacePlanCase(0, {
      clipFramePosition: Number.MAX_SAFE_INTEGER + 1,
    })],
    ['Plan rejects sheet frame index -1', assertQualityGatePlanRequest, replacePlanCase(0, {
      sheetFrameIndex: -1,
    })],
    ['Plan rejects sheet frame index 64', assertQualityGatePlanRequest, replacePlanCase(0, {
      sheetFrameIndex: 64,
    })],
    ['Plan rejects an unsafe sheet frame index', assertQualityGatePlanRequest, replacePlanCase(0, {
      sheetFrameIndex: Number.MAX_SAFE_INTEGER + 1,
    })],
    ['Plan rejects an empty instruction', assertQualityGatePlanRequest, replacePlanCase(0, {
      instruction: '   ',
    })],
    ['Plan rejects an empty expected improvement', assertQualityGatePlanRequest, replacePlanCase(0, {
      expectedImprovement: '   ',
    })],
    ['Plan rejects a zero-width mask edit', assertQualityGatePlanRequest, replacePlanCase(0, {
      maskEdits: [{ ...plan.cases[0].maskEdits[0], width: 0 }],
    })],
    ['Plan rejects an unsupported mask operation', assertQualityGatePlanRequest, replacePlanCase(0, {
      maskEdits: [{ ...plan.cases[0].maskEdits[0], op: 'replace_rectangle' }],
    })],
    ['Plan rejects an unsafe mask coordinate', assertQualityGatePlanRequest, replacePlanCase(0, {
      maskEdits: [{
        ...plan.cases[0].maskEdits[0],
        x: Number.MAX_SAFE_INTEGER + 1,
      }],
    })],
    ['difficulty distribution', assertQualityGatePlanRequest, replacePlanCase(0, { difficulty: 'medium' })],
    ['category distribution', assertQualityGatePlanRequest, replacePlanCase(0, { defectCategory: 'shape' })],
    ['duplicate case id', assertQualityGatePlanRequest, duplicateCaseId],
    ['duplicate asset id', assertQualityGatePlanRequest, duplicateAssetId],
    ['session regex', assertQualityGatePlanRequest, { ...plan, sessionId: 'FRQG bad session' }],
    ['Start rejects a malformed expected plan hash', assertQualityGateStartRequest, {
      ...start, expectedPlanHash: 'g'.repeat(64),
    }],
    ['Start requires session-start confirmation', assertQualityGateStartRequest, {
      ...start, confirmSessionStart: false,
    }],
    ['Start requires expectedPlanHash', assertQualityGateStartRequest, omitKey(
      start,
      'expectedPlanHash',
    )],
    ['route projectId is required', assertQualityGateRouteIds, { ...routeIds, projectId: null }],
    ['route rejects caseId when sessionId is null', assertQualityGateRouteIds, {
      ...routeIds, sessionId: null, caseId: 'case_shape_01',
    }],
    ['route rejects an 81-character project id', assertQualityGateRouteIds, {
      ...routeIds, projectId: 'p'.repeat(81),
    }],
    ['route rejects an 81-character case id', assertQualityGateRouteIds, {
      ...routeIds, caseId: 'c'.repeat(81),
    }],
    ['route rejects a too-short session id', assertQualityGateRouteIds, {
      ...routeIds, sessionId: `frqg_${'s'.repeat(15)}`,
    }],
    ['route rejects a too-long session id', assertQualityGateRouteIds, {
      ...routeIds, sessionId: `frqg_${'s'.repeat(81)}`,
    }],
    ['route traversal', assertQualityGateRouteIds, { ...routeIds, projectId: '../secret' }],
    ['route slash', assertQualityGateRouteIds, { ...routeIds, caseId: 'folder/case' }],
    ['route backslash', assertQualityGateRouteIds, { ...routeIds, caseId: 'folder\\case' }],
    ['route NUL', assertQualityGateRouteIds, { ...routeIds, caseId: 'case\0secret' }],
    ['route absolute path', assertQualityGateRouteIds, { ...routeIds, projectId: '/absolute' }],
    ['mask exceeds 96 by 96', assertQualityGatePlanRequest, replacePlanCase(0, {
      maskEdits: [{ op: 'add_rectangle', x: 95, y: 0, width: 2, height: 1 }],
    })],
    ['mask has 65 edits', assertQualityGatePlanRequest, replacePlanCase(0, {
      maskEdits: Array.from({ length: 65 }, () => ({
        op: 'add_rectangle', x: 0, y: 0, width: 1, height: 1,
      })),
    })],
    ['instruction exceeds 500 code points', assertQualityGatePlanRequest, replacePlanCase(0, {
      instruction: '\ud83d\ude00'.repeat(501),
    })],
    ['expected improvement exceeds 500 code points', assertQualityGatePlanRequest, replacePlanCase(0, {
      expectedImprovement: '\ud83d\ude00'.repeat(501),
    })],
    ['target project name exceeds 160 code points', assertQualityGateSetupRequest, {
      ...setup, targetProjectName: '\ud83d\ude00'.repeat(161),
    }],
    ['duplicate review reason', assertQualityGateReviewRequest, {
      ...review, reasonCodes: ['outline_repaired', 'outline_repaired'],
    }],
    ['more than 16 review reasons', assertQualityGateReviewRequest, {
      ...review,
      reasonCodes: Array.from({ length: 17 }, (_, index) => QUALITY_GATE_REASON_CODES[index % 15]),
    }],
    ['Review rejects an unknown blind choice', assertQualityGateReviewRequest, {
      ...review, blindChoice: 'prefer_c',
    }],
    ['Review rejects an unknown improvement result', assertQualityGateReviewRequest, {
      ...review, improvement: 'partially_improved',
    }],
    ['Review rejects an unknown usability result', assertQualityGateReviewRequest, {
      ...review, usability: 'partially_usable',
    }],
    ['Review requires a boolean newBlockingDefect', assertQualityGateReviewRequest, {
      ...review, newBlockingDefect: 'false',
    }],
    ['Review rejects an unknown reason code', assertQualityGateReviewRequest, {
      ...review, reasonCodes: ['unknown_reason'],
    }],
    ['Review rejects a note over 500 Unicode code points', assertQualityGateReviewRequest, {
      ...review, note: '\ud83d\ude00'.repeat(501),
    }],
    ['Review rejects note control characters', assertQualityGateReviewRequest, {
      ...review, note: 'invalid\nnote',
    }],
    ['Review rejects a malformed expected plan hash', assertQualityGateReviewRequest, {
      ...review, expectedPlanHash: 'g'.repeat(64),
    }],
    ['Review rejects a malformed expected case hash', assertQualityGateReviewRequest, {
      ...review, expectedCaseHash: 'g'.repeat(64),
    }],
    ['Review rejects an invalid repository job id', assertQualityGateReviewRequest, {
      ...review, jobId: 'invalid/job',
    }],
    ...invalidOperationIds.flatMap((operationId, index) => [
      [`review operation id ${index + 1}`, assertQualityGateReviewRequest, { ...review, operationId }],
      [`outcome operation id ${index + 1}`, assertQualityGateOutcomeRequest, { ...outcome, operationId }],
    ]),
    ...outcomeNullabilityErrors.map((value, index) => [
      `outcome nullability ${index + 1}`, assertQualityGateOutcomeRequest, value,
    ]),
    ['outcome revision is required', assertQualityGateOutcomeRequest, {
      ...outcome, expectedProjectRevision: null,
    }],
    ['outcome revision is a safe integer', assertQualityGateOutcomeRequest, {
      ...outcome, expectedProjectRevision: Number.MAX_SAFE_INTEGER + 1,
    }],
    ['outcome enum is controlled', assertQualityGateOutcomeRequest, {
      ...outcome, outcome: 'partially_accepted',
    }],
    ['Outcome rejects a malformed expected plan hash', assertQualityGateOutcomeRequest, {
      ...outcome, expectedPlanHash: 'g'.repeat(64),
    }],
    ['Outcome rejects a malformed expected case hash', assertQualityGateOutcomeRequest, {
      ...outcome, expectedCaseHash: 'g'.repeat(64),
    }],
    ['Outcome rejects an invalid repository job id', assertQualityGateOutcomeRequest, {
      ...outcome, jobId: 'invalid/job',
    }],
    ['Outcome rejects an invalid accepted revision id', assertQualityGateOutcomeRequest, {
      ...outcome, acceptedRevisionId: '../rev_002',
    }],
    ['Finalize confirmation false', assertQualityGateFinalizeRequest, {
      ...finalize, confirmFinalize: false,
    }],
    ['Finalize rejects a malformed expected plan hash', assertQualityGateFinalizeRequest, {
      ...finalize, expectedPlanHash: 'g'.repeat(64),
    }],
    ['Finalize rejects a negative expected revision', assertQualityGateFinalizeRequest, {
      ...finalize, expectedRevision: -1,
    }],
    ['Finalize rejects an unsafe expected revision', assertQualityGateFinalizeRequest, {
      ...finalize, expectedRevision: Number.MAX_SAFE_INTEGER + 1,
    }],
    ['Finalize requires expectedRevision', assertQualityGateFinalizeRequest, omitKey(
      finalize,
      'expectedRevision',
    )],
  ];
  for (const [name, validate, value] of badCases) {
    const input = deepFreeze(structuredClone(value));
    assert.throws(() => validate(input), (error) => {
      assert.equal(error instanceof FrameRepairQualityGateError, true);
      return true;
    }, name);
  }

  const assertMaliciousInputIsNotEchoed = (error, maliciousKey, maliciousValue) => {
    assert.equal(error instanceof FrameRepairQualityGateError, true);
    const serializedDetails = JSON.stringify(error.details) ?? '';
    const serializedError = JSON.stringify({
      name: error.name,
      message: error.message,
      code: error.code,
      details: error.details,
    });
    for (const maliciousText of [maliciousKey, maliciousValue]) {
      assert.equal(error.message.includes(maliciousText), false);
      assert.equal(error.code.includes(maliciousText), false);
      assert.equal(serializedDetails.includes(maliciousText), false);
      assert.equal(serializedError.includes(maliciousText), false);
    }
    return true;
  };
  const maliciousKey = 'malicious_key_DO_NOT_ECHO_74b9';
  const maliciousValue = 'malicious_value_DO_NOT_ECHO_c112';
  const nestedMaliciousKey = 'nested_malicious_key_DO_NOT_ECHO_5ea1';
  const nestedMaliciousValue = 'nested_malicious_value_DO_NOT_ECHO_a938';
  const maliciousInputs = [
    [
      'top-level malicious input',
      { ...structuredClone(setup), [maliciousKey]: maliciousValue },
      maliciousKey,
      maliciousValue,
    ],
    [
      'nested malicious input',
      {
        ...structuredClone(setup),
        sourceAssets: setup.sourceAssets.map((item, index) => (
          index === 0
            ? { ...structuredClone(item), [nestedMaliciousKey]: nestedMaliciousValue }
            : structuredClone(item)
        )),
      },
      nestedMaliciousKey,
      nestedMaliciousValue,
    ],
  ];
  for (const [name, value, key, suppliedValue] of maliciousInputs) {
    assert.throws(
      () => assertQualityGateSetupRequest(deepFreeze(value)),
      (error) => assertMaliciousInputIsNotEchoed(error, key, suppliedValue),
      name,
    );
  }
});

test('revoked proxies fail with controlled quality-gate errors without echoing values', () => {
  const revokeProxy = (target) => {
    const revocable = Proxy.revocable(target, {});
    revocable.revoke();
    return revocable.proxy;
  };
  const topLevelSentinel = 'Revoked top level sentinel 8f17';
  const revokedSetup = revokeProxy({
    ...structuredClone(setup),
    targetProjectName: topLevelSentinel,
  });
  const nestedSentinels = [
    'case_revoked_probe_7d31',
    'asset_revoked_probe_7d31',
    'rev_revoked_probe_7d31',
  ];
  const revokedSourceAsset = revokeProxy({
    ...structuredClone(setup.sourceAssets[0]),
    caseId: nestedSentinels[0],
    assetId: nestedSentinels[1],
    expectedAssetRevisionId: nestedSentinels[2],
  });
  const setupWithRevokedSourceAsset = {
    ...structuredClone(setup),
    sourceAssets: setup.sourceAssets.map((item, index) => (
      index === 0 ? revokedSourceAsset : structuredClone(item)
    )),
  };
  const revokedSourceAssets = revokeProxy(setup.sourceAssets.map((item) => (
    structuredClone(item)
  )));
  const setupWithRevokedSourceAssets = {
    ...structuredClone(setup),
    sourceAssets: revokedSourceAssets,
  };

  for (const [name, value, forbiddenEchoes] of [
    ['top-level Setup record', revokedSetup, [topLevelSentinel]],
    ['nested source asset record', setupWithRevokedSourceAsset, nestedSentinels],
    ['sourceAssets array', setupWithRevokedSourceAssets, ['asset_shape_01']],
  ]) {
    assert.throws(() => assertQualityGateSetupRequest(value), (error) => {
      assert.equal(
        error instanceof FrameRepairQualityGateError,
        true,
        `${name} must not leak a native error`,
      );
      assert.equal(error.code, 'invalid_quality_gate_request');
      const serializedError = JSON.stringify({
        name: error.name,
        message: error.message,
        code: error.code,
        details: error.details,
      });
      for (const forbiddenEcho of forbiddenEchoes) {
        assert.equal(serializedError.includes(forbiddenEcho), false);
      }
      return true;
    }, name);
  }
});

test('rejects an oversized dense-array envelope before enumerating descriptors', () => {
  let ownKeysCalled = false;
  const oversizedMaskEdits = new Proxy(new Array(65), {
    ownKeys(target) {
      ownKeysCalled = true;
      return Reflect.ownKeys(target);
    },
  });
  const planWithOversizedMaskEdits = {
    ...structuredClone(plan),
    cases: plan.cases.map((item, index) => (
      index === 0
        ? { ...structuredClone(item), maskEdits: oversizedMaskEdits }
        : structuredClone(item)
    )),
  };

  assert.throws(() => assertQualityGatePlanRequest(planWithOversizedMaskEdits), (error) => {
    assert.equal(error instanceof FrameRepairQualityGateError, true);
    assert.equal(error.code, 'invalid_quality_gate_plan');
    return true;
  });
  assert.equal(ownKeysCalled, false);
});

test('representative validation failures preserve exact error codes and field counts', () => {
  const exactErrorCases = [
    [
      'unexpected Setup field',
      assertQualityGateSetupRequest,
      { ...setup, unexpected: true },
      'unexpected_request_field',
      { field_count: 1 },
    ],
    [
      'missing Finalize field',
      assertQualityGateFinalizeRequest,
      omitKey(finalize, 'expectedRevision'),
      'invalid_quality_gate_request',
      { field_count: 1 },
    ],
    [
      'invalid Plan scalar',
      assertQualityGatePlanRequest,
      { ...plan, expectedRevision: -1 },
      'invalid_quality_gate_plan',
      null,
    ],
  ];

  for (const [name, validate, value, expectedCode, expectedDetails] of exactErrorCases) {
    assert.throws(() => validate(deepFreeze(structuredClone(value))), (error) => {
      assert.equal(error instanceof FrameRepairQualityGateError, true);
      assert.equal(error.code, expectedCode);
      assert.deepEqual(error.details, expectedDetails);
      return true;
    }, name);
  }
});

test('rejects non-plain and accessor-bearing records without invoking accessors', () => {
  const nonPlainSetup = Object.assign(Object.create({}), structuredClone(setup));
  Object.freeze(nonPlainSetup);
  const nonPlainImageConfig = Object.assign(
    Object.create({}),
    structuredClone(plan.imageConfig),
  );
  Object.freeze(nonPlainImageConfig);
  const planWithNonPlainImageConfig = Object.freeze({
    ...structuredClone(plan),
    imageConfig: nonPlainImageConfig,
  });
  for (const [validate, value] of [
    [assertQualityGateSetupRequest, nonPlainSetup],
    [assertQualityGatePlanRequest, planWithNonPlainImageConfig],
  ]) {
    assert.throws(() => validate(value), FrameRepairQualityGateError);
  }

  let accessorRead = false;
  const accessorSetup = structuredClone(setup);
  Object.defineProperty(accessorSetup, 'targetProjectName', {
    enumerable: true,
    get() {
      accessorRead = true;
      return setup.targetProjectName;
    },
  });
  Object.freeze(accessorSetup);
  assert.throws(
    () => assertQualityGateSetupRequest(accessorSetup),
    FrameRepairQualityGateError,
  );
  assert.equal(accessorRead, false);
});

test('protocol implementation remains deterministic and dependency-free', () => {
  const source = readFileSync(new URL(
    '../../src/editor-project/frameRepairQualityGateProtocol.js', import.meta.url,
  ), 'utf8');
  const providerOrStoreImport = /(?:^\s*import(?:\s|['"])[^\n]*(?:provider|store)|\b(?:import|require)\s*\(\s*['"][^'"]*(?:provider|store)[^'"]*['"]\s*\))/im;
  const forbiddenDependencies = [
    ['static import', /^\s*import(?:\s|['"])/m],
    ['dynamic import', /\bimport\s*\(/],
    ['CommonJS require', /\brequire\s*\(/],
    ['bare fs module', /['"]fs['"]/],
    ['bare fs\/promises module', /['"]fs\/promises['"]/],
    ['node:fs module', /['"]node:fs(?:\/promises)?['"]/],
    ['process environment access', /process\.env/],
    ['sharp dependency', /\bsharp\b/i],
    ['provider or store import', providerOrStoreImport],
  ];
  for (const [name, forbidden] of forbiddenDependencies) {
    assert.doesNotMatch(source, forbidden, name);
  }
  assert.match(source, /\bproviderPresetId\b/);
});
