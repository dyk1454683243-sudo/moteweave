export const QUALITY_GATE_LAYER_IDS = Object.freeze(['smoke', 'local-golden', 'release', 'live'])

const QUALITY_GATE_LAYERS = Object.freeze({
  smoke: {
    id: 'smoke',
    mode: 'provider_free',
    quota_required: false,
    purpose: 'fast provider-free regression sanity check',
    minimum_samples: 1,
    strict_warnings: false,
    interpretation: {
      pass: 'All selected local samples pass and manifest integrity is clean.',
      warning: 'No blocking failures, but one or more warnings need review.',
      fail: 'A sample failed, manifest validation failed, or no local sample was selected.',
    },
    claim_boundary: 'Smoke gates prove the local pipeline is callable, not broad image quality.',
  },
  'local-golden': {
    id: 'local-golden',
    mode: 'provider_free',
    quota_required: false,
    purpose: 'controlled local-image quality regression gate',
    minimum_samples: 1,
    strict_warnings: false,
    interpretation: {
      pass: 'All tracked local golden samples pass and expected statuses match.',
      warning: 'No blocking failures, but sample or manifest warnings require inspection.',
      fail: 'At least one sample failed, errored, or contradicted its expected status.',
    },
    claim_boundary: 'Local-golden gates support provider-free regression claims only.',
  },
  release: {
    id: 'release',
    mode: 'provider_free',
    quota_required: false,
    purpose: 'publish-before-merge local quality gate',
    minimum_samples: 1,
    strict_warnings: true,
    interpretation: {
      pass: 'Manifest validation is clean and every selected sample passes without warnings.',
      warning: 'Reserved for non-blocking release notes; current local release gate escalates sample warnings to fail.',
      fail: 'Any manifest warning/error, sample warning/fail/error, expectation mismatch, or empty sample set blocks release.',
    },
    claim_boundary: 'Release gates must cite sample count and remain separate from live-provider quality claims.',
  },
  live: {
    id: 'live',
    mode: 'live_provider',
    quota_required: true,
    purpose: 'opt-in quota-spending live provider gate',
    minimum_samples: 1,
    strict_warnings: false,
    interpretation: {
      pass: 'The selected live-provider cases passed their configured quality gate.',
      warning: 'Live generation produced usable output with quality warnings.',
      fail: 'Provider routing failed, all candidates failed, or generated output failed the gate.',
    },
    claim_boundary: 'Live gates require explicit quota consent and provider/model metadata.',
  },
})

function normalizeLayerId(layer) {
  return String(layer || 'local-golden').trim().replace(/_/g, '-').toLowerCase()
}

export function getQualityGateLayer(layer = 'local-golden') {
  const id = normalizeLayerId(layer)
  const definition = QUALITY_GATE_LAYERS[id]
  if (!definition) {
    throw new Error(`Unknown quality gate layer: ${layer}. Expected one of: ${QUALITY_GATE_LAYER_IDS.join(', ')}`)
  }
  return definition
}

export function listQualityGateLayers() {
  return QUALITY_GATE_LAYER_IDS.map((id) => QUALITY_GATE_LAYERS[id])
}

export function assertProviderFreeQualityGateLayer(layer, command = 'provider-free benchmark') {
  const definition = getQualityGateLayer(layer)
  if (definition.quota_required) {
    throw new Error(`${command} cannot run --gate-layer live because live gates spend provider quota; use a live benchmark command with explicit --yes consent`)
  }
  return definition
}

function aggregateGateStatus(gates) {
  if (gates.some((gate) => gate.status === 'fail')) return 'fail'
  if (gates.some((gate) => gate.status === 'warning')) return 'warning'
  return 'pass'
}

function gate(id, status, message, details = {}) {
  return { id, status, message, ...details }
}

function issueCounts(issues = []) {
  return {
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
  }
}

function manifestGateStatus({ manifestValidation, strictWarnings }) {
  const summary = manifestValidation?.summary ?? {}
  if ((summary.errors ?? 0) > 0 || summary.status === 'fail') return 'fail'
  if (strictWarnings && (summary.warnings ?? 0) > 0) return 'fail'
  if ((summary.warnings ?? 0) > 0 || summary.status === 'warning') return 'warning'
  return 'pass'
}

function sampleQualityGateStatus({ summary, strictWarnings }) {
  const validation = summary?.validation ?? {}
  if ((validation.fail ?? 0) > 0 || (validation.error ?? 0) > 0) return 'fail'
  if (strictWarnings && (validation.warning ?? 0) > 0) return 'fail'
  if ((validation.warning ?? 0) > 0) return 'warning'
  return 'pass'
}

function expectationGateStatus(summary) {
  if (!summary?.expectation_count) return 'pass'
  return summary.expectation_met_count === summary.expectation_count ? 'pass' : 'fail'
}

function repositorySafetyGateStatus(manifestValidation) {
  const issues = manifestValidation?.issues ?? []
  return issues.some((issue) => issue.code === 'sample.source_rights_not_repository_safe') ? 'fail' : 'pass'
}

function taxonomyFromGates(gates) {
  return gates
    .filter((item) => item.status === 'fail' || item.status === 'warning')
    .map((item) => ({
      category: `quality_gate.${item.id}`,
      severity: item.status,
      count: 1,
      examples: [item.message],
    }))
}

export function evaluateLocalImageQualityGate({ layer = 'local-golden', summary, manifestValidation } = {}) {
  const definition = assertProviderFreeQualityGateLayer(layer, 'benchmark local-images')
  const strictWarnings = Boolean(definition.strict_warnings)
  const sampleTotal = summary?.total ?? 0
  const manifestCounts = issueCounts(manifestValidation?.issues ?? [])
  const gates = [
    gate(
      'sample_count',
      sampleTotal >= definition.minimum_samples ? 'pass' : 'fail',
      sampleTotal >= definition.minimum_samples
        ? `${sampleTotal} local sample(s) selected`
        : `quality gate requires at least ${definition.minimum_samples} local sample(s)`,
      { minimum_samples: definition.minimum_samples, sample_count: sampleTotal }
    ),
    gate(
      'manifest_integrity',
      manifestGateStatus({ manifestValidation, strictWarnings }),
      strictWarnings
        ? 'manifest validation must have zero errors and zero warnings'
        : 'manifest validation must have zero errors',
      manifestCounts
    ),
    gate(
      'repository_safety',
      repositorySafetyGateStatus(manifestValidation),
      'tracked local golden samples must declare repository-safe source rights'
    ),
    gate(
      'sample_quality',
      sampleQualityGateStatus({ summary, strictWarnings }),
      strictWarnings
        ? 'selected samples must pass without warnings'
        : 'selected samples must not fail or error',
      summary?.validation ?? {}
    ),
    gate(
      'expectation_alignment',
      expectationGateStatus(summary),
      'sample expected_status entries must match observed status when provided',
      {
        expectation_count: summary?.expectation_count ?? 0,
        expectation_met_count: summary?.expectation_met_count ?? 0,
      }
    ),
  ]
  const warnings = gates.filter((item) => item.status === 'warning').map((item) => item.id)
  const blockingErrors = gates.filter((item) => item.status === 'fail').map((item) => item.id)
  return {
    schema_version: 'quality_gate_v0_1',
    id: 'local_image_quality_gate',
    layer: definition.id,
    mode: definition.mode,
    quota_required: definition.quota_required,
    purpose: definition.purpose,
    status: aggregateGateStatus(gates),
    gates,
    warnings,
    blocking_errors: blockingErrors,
    failure_taxonomy: taxonomyFromGates(gates),
    interpretation: definition.interpretation,
    claim_boundary: definition.claim_boundary,
  }
}
