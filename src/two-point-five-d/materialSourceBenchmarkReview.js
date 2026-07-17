import sharp from 'sharp'

export {
  TWO_POINT_FIVE_D_MATERIAL_SOURCE_BENCHMARK_REVIEW_MODE,
  buildTwoPointFiveDMaterialSourceBenchmarkReview,
} from './materialSourceBenchmarkReviewCore.js'

function md(value = '') {
  return String(value ?? '').replace(/\|/g, '\\|')
}

function html(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]))
}

function clipText(value = '', maxLength = 96) {
  const text = String(value ?? '')
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`
}

function statusColor(status = '') {
  if (status === 'ready_to_expand' || status === 'pass') return '#72d391'
  if (status === 'review_warnings' || status === 'warning') return '#f6c85f'
  return '#ff7a7a'
}

export function renderTwoPointFiveDMaterialSourceBenchmarkReviewMarkdown(review = {}) {
  const lines = [
    `# 2.5D Material Source Benchmark Review`,
    '',
    `Review status: ${review.status ?? 'unknown'}`,
    `Release ready: ${review.release_ready ? 'yes' : 'no'}`,
    `Next action: ${review.decision?.next_action ?? 'inspect_report'}`,
    `Priority: ${review.decision?.priority ?? 'P0'}`,
    `Rationale: ${review.decision?.rationale ?? 'No rationale recorded.'}`,
    '',
    '## Summary',
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    `| Cases | ${review.summary?.case_count ?? 0} |`,
    `| Candidates | ${review.summary?.candidate_count ?? 0} |`,
    `| Selected usable rate | ${review.summary?.selected_usable_rate ?? 0} |`,
    `| Selected pass rate | ${review.summary?.selected_pass_rate ?? 0} |`,
    `| Provider errors | ${review.summary?.provider_error_count ?? 0} |`,
    `| Completed candidates | ${review.summary?.completed_candidate_count ?? 0} |`,
    '',
    '## Top Issues',
    '',
  ]

  const topIssues = review.top_issues ?? []
  if (topIssues.length) {
    for (const issue of topIssues.slice(0, 12)) {
      lines.push(`- ${issue.id}: ${issue.count} (${issue.severity})`)
    }
  } else {
    lines.push('- none')
  }

  lines.push(
    '',
    '## Selected Cases',
    '',
    '| Case | Selected | Status | Warnings | Blocking | Output |',
    '| --- | --- | --- | ---: | ---: | --- |',
  )
  for (const item of review.selected_cases ?? []) {
    lines.push(`| ${md(item.case_id)} | ${md(item.selected_candidate_id ?? 'none')} | ${md(item.selected_status)} | ${item.warning_count ?? 0} | ${item.blocking_error_count ?? 0} | ${md(item.output_dir ?? '')} |`)
  }

  lines.push('', `Claim boundary: ${review.claim_boundary ?? ''}`, '')
  return `${lines.join('\n')}`
}

export function renderTwoPointFiveDMaterialSourceBenchmarkReviewHtml(review = {}) {
  const topIssues = review.top_issues ?? []
  const selectedCases = review.selected_cases ?? []
  const statusClass = html(review.status ?? 'unknown')
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>2.5D Material Source Benchmark Review</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #101419; color: #edf2f7; }
    body { margin: 0; padding: 24px; }
    main { max-width: 1180px; margin: 0 auto; }
    .summary { border: 1px solid #2d3748; border-radius: 8px; background: #151b22; padding: 16px; }
    .summary dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 0; }
    dt { color: #9aa7b5; font-size: 12px; text-transform: uppercase; }
    dd { margin: 4px 0 0; font-size: 18px; font-weight: 700; }
    .decision { margin-top: 18px; border: 1px solid #2d3748; border-radius: 8px; background: #151b22; padding: 16px; }
    .decision strong { color: #f6c85f; }
    .decision.ready_to_expand strong { color: #72d391; }
    .decision.provider_blocked strong, .decision.needs_quality_work strong, .decision.invalid_report strong { color: #ff7a7a; }
    table { width: 100%; border-collapse: collapse; margin-top: 18px; }
    th, td { border-bottom: 1px solid #2d3748; padding: 8px; text-align: left; vertical-align: top; }
    th { color: #9aa7b5; font-size: 12px; text-transform: uppercase; }
    .issues { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; margin-top: 18px; }
    .issue { border: 1px solid #2d3748; border-radius: 8px; background: #151b22; padding: 12px; }
    .claim { margin-top: 20px; color: #9aa7b5; }
  </style>
</head>
<body>
<main>
  <h1>2.5D Material Source Benchmark Review</h1>
  <section class="summary">
    <dl>
      <div><dt>Review status</dt><dd>${html(review.status ?? 'unknown')}</dd></div>
      <div><dt>Release ready</dt><dd>${review.release_ready ? 'yes' : 'no'}</dd></div>
      <div><dt>Cases</dt><dd>${html(review.summary?.case_count ?? 0)}</dd></div>
      <div><dt>Candidates</dt><dd>${html(review.summary?.candidate_count ?? 0)}</dd></div>
      <div><dt>Selected usable rate</dt><dd>${html(review.summary?.selected_usable_rate ?? 0)}</dd></div>
      <div><dt>Provider errors</dt><dd>${html(review.summary?.provider_error_count ?? 0)}</dd></div>
    </dl>
  </section>
  <section class="decision ${statusClass}">
    <h2>Decision</h2>
    <p><strong>${html(review.decision?.next_action ?? 'inspect_report')}</strong> · ${html(review.decision?.priority ?? 'P0')}</p>
    <p>${html(review.decision?.rationale ?? 'No rationale recorded.')}</p>
  </section>
  <h2>Top Issues</h2>
  <section class="issues">
    ${topIssues.length ? topIssues.slice(0, 12).map((issue) => `
    <article class="issue">
      <strong>${html(issue.id)}</strong>
      <p>Count: ${html(issue.count)} · Severity: ${html(issue.severity)}</p>
      <p>${html((issue.examples ?? []).join(', ') || 'no examples')}</p>
    </article>`).join('') : '<article class="issue"><strong>none</strong><p>No top issues recorded.</p></article>'}
  </section>
  <h2>Selected Cases</h2>
  <table>
    <thead><tr><th>Case</th><th>Selected</th><th>Status</th><th>Warnings</th><th>Blocking</th><th>Output</th></tr></thead>
    <tbody>
      ${selectedCases.map((item) => `<tr><td>${html(item.case_id)}</td><td>${html(item.selected_candidate_id ?? 'none')}</td><td>${html(item.selected_status)}</td><td>${html(item.warning_count ?? 0)}</td><td>${html(item.blocking_error_count ?? 0)}</td><td>${html(item.output_dir ?? '')}</td></tr>`).join('')}
    </tbody>
  </table>
  <p class="claim">${html(review.claim_boundary ?? '')}</p>
</main>
</body>
</html>`
}

export async function renderTwoPointFiveDMaterialSourceBenchmarkReviewPng(review = {}) {
  const topIssues = (review.top_issues ?? []).slice(0, 5)
  const selectedCases = (review.selected_cases ?? []).slice(0, 6)
  const width = 1440
  let y = 136
  const summaryCards = [
    ['Status', review.status ?? 'unknown'],
    ['Release', review.release_ready ? 'ready' : 'not_ready'],
    ['Cases', review.summary?.case_count ?? 0],
    ['Candidates', review.summary?.candidate_count ?? 0],
    ['Usable', review.summary?.selected_usable_rate ?? 0],
    ['Provider errors', review.summary?.provider_error_count ?? 0],
  ]
  const summarySvg = summaryCards.map(([label, value], index) => {
    const x = 48 + index * 224
    return `
      <rect x="${x}" y="96" width="204" height="76" rx="12" fill="#151b22" stroke="#2d3748"/>
      <text x="${x + 16}" y="126" fill="#9aa7b5" font-size="15">${html(label)}</text>
      <text x="${x + 16}" y="154" fill="#edf2f7" font-size="24" font-weight="800">${html(value)}</text>
    `
  }).join('')

  y = 204
  const decisionColor = statusColor(review.status)
  const decisionSvg = `
    <rect x="48" y="${y}" width="1344" height="104" rx="12" fill="#151b22" stroke="#2d3748"/>
    <text x="76" y="${y + 34}" fill="#edf2f7" font-size="24" font-weight="800">Decision</text>
    <rect x="1088" y="${y + 22}" width="256" height="36" rx="18" fill="${decisionColor}" fill-opacity="0.16" stroke="${decisionColor}"/>
    <text x="1216" y="${y + 47}" text-anchor="middle" fill="${decisionColor}" font-size="18" font-weight="800">${html(review.decision?.priority ?? 'P0')}</text>
    <text x="76" y="${y + 66}" fill="${decisionColor}" font-size="22" font-weight="800">${html(review.decision?.next_action ?? 'inspect_report')}</text>
    <text x="76" y="${y + 92}" fill="#9aa7b5" font-size="18">${html(clipText(review.decision?.rationale ?? 'No rationale recorded.', 132))}</text>
  `

  y += 136
  const issueCards = topIssues.length ? topIssues : [{ id: 'none', count: 0, severity: 'info', examples: [] }]
  const issuesSvg = [
    `<text x="48" y="${y}" fill="#edf2f7" font-size="26" font-weight="800">Top Issues</text>`,
    ...issueCards.map((issue, index) => {
      const top = y + 24 + index * 58
      const color = statusColor(issue.severity === 'blocking' ? 'error' : 'warning')
      return `
        <rect x="48" y="${top}" width="1344" height="44" rx="10" fill="#151b22" stroke="#2d3748"/>
        <circle cx="72" cy="${top + 22}" r="6" fill="${color}"/>
        <text x="92" y="${top + 28}" fill="#edf2f7" font-size="18" font-weight="700">${html(clipText(issue.id, 86))}</text>
        <text x="1136" y="${top + 28}" fill="#9aa7b5" font-size="17">count ${html(issue.count ?? 0)} - ${html(issue.severity ?? 'info')}</text>
      `
    }),
  ].join('')

  y += 24 + issueCards.length * 58 + 48
  const caseRows = selectedCases.length ? selectedCases : [{ case_id: 'none', selected_candidate_id: 'none', selected_status: 'not_available', warning_count: 0, blocking_error_count: 0, output_dir: '' }]
  const casesSvg = [
    `<text x="48" y="${y}" fill="#edf2f7" font-size="26" font-weight="800">Selected Cases</text>`,
    ...caseRows.map((item, index) => {
      const top = y + 24 + index * 58
      const color = statusColor(item.selected_status)
      return `
        <rect x="48" y="${top}" width="1344" height="44" rx="10" fill="#151b22" stroke="#2d3748"/>
        <text x="72" y="${top + 28}" fill="#edf2f7" font-size="18" font-weight="700">${html(clipText(item.case_id, 32))}</text>
        <text x="400" y="${top + 28}" fill="#9aa7b5" font-size="17">${html(item.selected_candidate_id ?? 'none')}</text>
        <text x="680" y="${top + 28}" fill="${color}" font-size="17" font-weight="800">${html(item.selected_status)}</text>
        <text x="890" y="${top + 28}" fill="#9aa7b5" font-size="17">warnings ${html(item.warning_count ?? 0)} / blocking ${html(item.blocking_error_count ?? 0)}</text>
      `
    }),
  ].join('')

  y += 24 + caseRows.length * 58 + 86
  const height = Math.max(760, y)
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#101419"/>
  <text x="48" y="54" fill="#edf2f7" font-size="34" font-weight="900">2.5D Material Source Benchmark Review</text>
  <text x="48" y="82" fill="#9aa7b5" font-size="18">Provider output is reviewed as raw material source; local deterministic code owns final tileset structure.</text>
  ${summarySvg}
  ${decisionSvg}
  ${issuesSvg}
  ${casesSvg}
  <text x="48" y="${height - 30}" fill="#667487" font-size="15">${html(clipText(review.claim_boundary ?? '', 150))}</text>
</svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}
