const MAX_EXAMPLES = 5
const SEVERITY_RANK = Object.freeze({
  error: 3,
  warning: 2,
  info: 1,
})

const FAILURE_MODE_CATEGORIES = Object.freeze({
  model_error: 'provider.model_error',
  post_processing: 'pipeline.post_processing',
  unexpected_error: 'pipeline.unexpected_error',
})

function normalizeMessages(messages) {
  return Array.isArray(messages) ? messages.map(String).filter(Boolean) : []
}

function severityRank(severity) {
  return SEVERITY_RANK[severity] ?? SEVERITY_RANK.info
}

function categoryForMessage(message) {
  if (message === 'frame_count_mismatch') return 'structure.frame_count'
  if (/^frame_\d+_empty$/.test(message)) return 'structure.empty_frame'
  if (/^frame_\d+_cropped$/.test(message)) return 'structure.cropped'
  if (message.endsWith('_low_motion')) return 'motion.low_motion'
  if (message.startsWith('source_action_low_motion:')) return 'motion.source_low_motion'
  if (message.startsWith('source_region_empty:')) return 'source.empty_region'
  if (message.startsWith('source_region_low_occupancy:')) return 'source.low_occupancy'
  if (message.startsWith('source_region_halo:')) return 'source.halo'
  if (message.startsWith('source_region_edge_pressure:')) return 'source.edge_pressure'
  if (message === 'source_layout_alignment_mismatch') return 'source.layout_alignment'
  if (/^frame_\d+_anchor_drift$/.test(message)) return 'alignment.anchor_drift'
  if (/^frame_\d+_baseline_drift$/.test(message)) return 'alignment.baseline_drift'
  if (message.includes('subpixel_jitter')) return 'alignment.subpixel_jitter'
  if (message === 'halo_score_high') return 'background.halo'
  if (message.includes('dual_matte')) return 'background.dual_matte'
  if (message === 'source_region_edge_pressure_high') return 'layout.source_region_edge_pressure'
  if (message === 'edge_pressure_high') return 'composition.edge_pressure'
  return null
}

function createCategoryAccumulator() {
  const byId = new Map()
  let order = 0

  function add(id, severity, example, count = 1) {
    if (!id) return
    const existing = byId.get(id)
    if (existing) {
      existing.count += Math.max(0, count)
      if (severityRank(severity) > severityRank(existing.severity)) existing.severity = severity
      if (example && !existing.examples.includes(example) && existing.examples.length < MAX_EXAMPLES) existing.examples.push(example)
      return
    }
    if (count <= 0) return
    byId.set(id, {
      id,
      severity,
      count,
      examples: example ? [example] : [],
      order: order++,
    })
  }

  function categories() {
    return [...byId.values()]
      .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.order - b.order)
      .map(({ order: _order, ...category }) => category)
  }

  return { add, categories }
}

function taxonomyFromCategories(categories) {
  const sorted = [...categories].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
  return {
    primary: sorted[0]?.id ?? null,
    severity: sorted[0]?.severity ?? 'info',
    categories,
  }
}

export function classifyValidationMessages({ status, warnings = [], blocking_errors = [], metrics = {} } = {}) {
  const accumulator = createCategoryAccumulator()

  for (const message of normalizeMessages(blocking_errors)) {
    accumulator.add(categoryForMessage(message), 'error', message)
  }
  for (const message of normalizeMessages(warnings)) {
    accumulator.add(categoryForMessage(message), 'warning', message)
  }

  if (status !== 'pass' && Array.isArray(metrics.duplicate_frames) && metrics.duplicate_frames.length > 0) {
    accumulator.add('motion.duplicate_frames', 'warning', 'duplicate_frames', metrics.duplicate_frames.length)
  }

  return taxonomyFromCategories(accumulator.categories())
}

export function classifyBenchmarkItem(item = {}) {
  const accumulator = createCategoryAccumulator()
  const validationTaxonomy = item.validation?.failure_taxonomy?.categories?.length
    ? item.validation.failure_taxonomy
    : classifyValidationMessages(item.validation ?? {})

  for (const category of validationTaxonomy.categories ?? []) {
    const examples = Array.isArray(category.examples) ? category.examples : []
    accumulator.add(category.id, category.severity ?? 'warning', examples[0], Number(category.count) || 1)
    for (const example of examples.slice(1)) accumulator.add(category.id, category.severity ?? 'warning', example, 0)
  }

  const failureCategory = FAILURE_MODE_CATEGORIES[item.failure?.mode]
  if (failureCategory) {
    accumulator.add(failureCategory, 'error', item.failure?.reason ?? item.failure.mode)
  }

  return taxonomyFromCategories(accumulator.categories())
}

export function summarizeFailureTaxonomy(items = []) {
  const accumulator = createCategoryAccumulator()
  let classified = 0
  const primary = {}

  for (const item of items) {
    const taxonomy = Array.isArray(item?.failure_taxonomy?.categories) ? item.failure_taxonomy : classifyBenchmarkItem(item)
    if (!taxonomy.categories?.length) continue
    classified += 1
    if (taxonomy.primary) primary[taxonomy.primary] = (primary[taxonomy.primary] ?? 0) + 1
    for (const category of taxonomy.categories) {
      const examples = Array.isArray(category.examples) ? category.examples : []
      accumulator.add(category.id, category.severity ?? 'warning', examples[0], Number(category.count) || 1)
      for (const example of examples.slice(1)) accumulator.add(category.id, category.severity ?? 'warning', example, 0)
    }
  }

  return {
    total: items.length,
    classified,
    primary,
    top_categories: accumulator.categories().sort((a, b) => b.count - a.count || severityRank(b.severity) - severityRank(a.severity)),
  }
}
