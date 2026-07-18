import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { isCharacterPackReleaseBlocked } from '../src/ui/characterPack/renderers.js'

test('character pack tab stays a thin initializer over focused UI modules', async () => {
  const source = await readFile('src/ui/characterPackTab.js', 'utf8')
  const lineCount = source.trimEnd().split(/\r?\n/).length

  assert.ok(lineCount <= 140, `characterPackTab.js has ${lineCount} lines; keep workflow logic in src/ui/characterPack/ modules`)
  assert.doesNotMatch(source, /\b(processCharacterSheet|generateCharacterSheet|waitForJob|fetchBenchmarkGallery)\b/)
  assert.match(source, /\binitCharacterPackWorkflowEvents\b/)
})

test('character pack v8 UI keeps shared fields and provider controls wired', async () => {
  const html = await readFile('index.html', 'utf8')
  const app = await readFile('src/app.js', 'utf8')
  const api = await readFile('src/ui/characterPack/api.js', 'utf8')
  const controls = await readFile('src/ui/characterPack/controls.js', 'utf8')
  const providerConfig = await readFile('src/ui/providerConfig.js', 'utf8')
  const providerStatus = await readFile('src/ui/characterPack/providerStatus.js', 'utf8')
  const renderers = await readFile('src/ui/characterPack/renderers.js', 'utf8')
  const jobStore = await readFile('src/character-pack/jobStore.js', 'utf8')
  const playablePreview = await readFile('src/ui/characterPack/playablePreviewWidget.js', 'utf8')
  const v8Css = await readFile('src/v8.css', 'utf8')
  const workflow = await readFile('src/ui/characterPack/workflows.js', 'utf8')
  const processingRequestOptions = await readFile('src/ui/characterPack/processingRequestOptions.js', 'utf8')
  const openRouterSmoke = await readFile('scripts/smoke-openrouter-generate.mjs', 'utf8')

  const descriptionIndex = html.indexOf('id="character-pack-description"')
  const sourceFilesIndex = html.indexOf('<!-- 2. SOURCE FILES')
  const aiGenerationIndex = html.indexOf('<!-- 2. AI GENERATION')

  assert.ok(descriptionIndex > 0, 'character-pack description control is missing')
  assert.ok(descriptionIndex < sourceFilesIndex, 'description must stay near asset identity instead of moving into generation controls')
  assert.ok(descriptionIndex < aiGenerationIndex, 'description must remain in the shared asset section so track switching can reveal it')
  assert.match(app, /import \{ initI18n \} from '\.\/ui\/i18n\.js'/)
  assert.match(app, /initI18n\(\)[\s\S]*initPromptTabs\(\)/)
  assert.match(html, /id="language-select"[\s\S]*value="zh"[\s\S]*value="en"/)
  assert.match(html, /data-i18n="app\.language"/)
  assert.match(html, /data-i18n="character\.asset\.title"/)
  assert.match(html, /data-i18n="character\.action\.processLocal"/)
  assert.match(html, /data-i18n-placeholder="character\.generation\.seedPlaceholder"/)
  assert.match(html, /data-i18n="character\.export\.downloadAvailable"[^>]*data-i18n-var-count="0"/)
  assert.match(html, /<label[^>]*data-track="ai"[^>]*hidden[^>]*>[\s\S]*data-i18n="character\.asset\.description"[\s\S]*id="character-pack-description"/)
  assert.match(html, /id="character-pack-t2i-mode"[\s\S]*value="production_sheet_v0" selected[\s\S]*value="quality_character_v0"/)
  assert.match(html, /id="character-pack-character-preset"[\s\S]*value="rpg_humanoid_v0" selected[\s\S]*value="two_to_one_character_v0"/)
  assert.match(html, /id="character-pack-source-layout"[\s\S]*value="fixed_region_motion_v0"/)
  assert.match(html, /id="character-pack-generation-layout"[\s\S]*value="fixed_region_motion_v0" selected/)
  assert.match(html, /id="character-pack-background"[\s\S]*value="auto" selected[\s\S]*value="passthrough"/)
  assert.doesNotMatch(html, /id="character-pack-background"[\s\S]{0,500}value="(?:flood_edge|alpha)"/)
  assert.match(html, /id="character-pack-motion-max-shift"[^>]*min="0"[^>]*max="4"/)
  assert.match(html, /id="character-pack-image-size"[\s\S]*value="1K"[\s\S]*value="2K" selected/)
  assert.match(html, /id="character-pack-candidate-count"[\s\S]*value="1" selected/)
  assert.doesNotMatch(html, /value="(?:512|1024|2048)x(?:512|1024|2048)"/)
  assert.match(html, /class="slicing-control-grid"[\s\S]*id="character-pack-auto-grid"[\s\S]*id="character-pack-reslice"[\s\S]*id="character-pack-manual-grid"[\s\S]*id="character-pack-reset-grid"/)
  assert.doesNotMatch(html, /input-with-button" style=/)
  assert.match(v8Css, /\.slicing-control-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(v8Css, /select:not\(\[multiple\]\)[\s\S]*padding-right:\s*24px[\s\S]*background-position:\s*right 16px center/)
  assert.match(html, /id="gemini-state"/)
  assert.match(html, /id="character-pack-runtime-provider"[\s\S]*value="openrouter_compatible"/)
  assert.match(html, /id="character-pack-runtime-model"/)
  assert.match(html, /id="character-pack-runtime-base-url-field"[^>]*hidden[\s\S]*id="character-pack-runtime-base-url"/)
  assert.match(html, /id="character-pack-runtime-api-key"[^>]*type="password"/)
  assert.match(html, /id="character-pack-toggle-api-key"[^>]*aria-label="Show API key"/)
  assert.match(html, /id="character-pack-save-provider-config"/)
  assert.match(html, /id="character-pack-clear-provider-config"/)
  assert.match(html, /id="character-pack-provider-preset"[^>]*hidden/)
  assert.match(html, /class="tab-button active"[^>]*data-tab="character-pack"/)
  assert.match(html, /class="tab-panel active" id="character-pack"/)
  assert.match(workflow, /#character-pack-t2i-mode/)
  assert.match(workflow, /#character-pack-candidate-count/)
  assert.match(workflow, /function localFixedRegionStagingOptions\(sourceLayout\)/)
  assert.match(workflow, /sourceLayout !== FIXED_REGION_MOTION_LAYOUT_ID/)
  assert.match(workflow, /fixedRegionSourceStaging:\s*'fixed_region_256_crop'/)
  assert.match(workflow, /fixedRegionMatteTolerance:\s*80/)
  assert.match(workflow, /const sourceLayout = getCharacterPackSourceLayout\(\)[\s\S]*processCharacterSheet\(file,\s*\{[\s\S]*description:\s*''[\s\S]*sourceLayout,[\s\S]*localFixedRegionStagingOptions\(sourceLayout\)/)
  assert.match(workflow, /generateCharacterSheet\(\$\(\'#character-pack-description\'\)\.value/)
  assert.match(workflow, /maxProviderCalls:\s*candidateCount/)
  assert.match(workflow, /buildCharacterProcessingRequestOptions/)
  assert.match(workflow, /processingRequestOptions\(\{ generation: true \}\)/)
  assert.doesNotMatch(workflow, /\b(?:minAlpha|minArea|minAreaRatio|motionMaxShift|export[1234]x):/)
  assert.match(processingRequestOptions, /motionStabilizationMaxShift/)
  assert.match(processingRequestOptions, /outputFrameSizes:\s*\[\.\.\.CHARACTER_OUTPUT_FRAME_SIZES\]/)
  assert.doesNotMatch(html, /id="character-pack-export-[1234]x"/)
  assert.match(html, /data-i18n="character\.export\.fixedSizes"/)
  assert.match(api, /maxProviderCalls:\s*options\.maxProviderCalls\s*\?\?\s*options\.candidateCount/)
  assert.match(api, /TERMINAL_JOB_STATUSES[\s\S]*'failed_quality_gate'/)
  assert.match(openRouterSmoke, /TERMINAL[\s\S]*'failed_quality_gate'/)
  assert.match(jobStore, /FAILED_QUALITY_GATE:\s*'failed_quality_gate'/)
  assert.match(controls, /failure_status/)
  assert.match(renderers, /provider_call_budget/)
  assert.match(renderers, /candidate_selection/)
  assert.match(renderers, /quality_spec/)
  assert.match(renderers, /release_selected_index/)
  assert.match(renderers, /release_ready/)
  assert.match(renderers, /artifact_disposition/)
  assert.match(renderers, /Diagnostic candidate/)
  assert.match(renderers, /Release candidate/)
  assert.match(renderers, /isCharacterPackReleaseBlocked/)
  assert.match(renderers, /const url = releaseBlocked \? null : job\[row\.dataset\.exportKey\]/)
  assert.match(renderers, /const zipUrl = releaseBlocked \? null : job\.zip_url/)
  assert.match(renderers, /const gifLinks = releaseBlocked\s*\? \[\]/)
  assert.match(v8Css, /playback-status\[data-status="failed_quality_gate"\]/)
  assert.match(renderers, /job\.inspection_gif_previews/)
  assert.match(renderers, /runtime_url/)
  assert.match(renderers, /strip_url/)
  assert.match(renderers, /gcard-download-row/)
  assert.match(renderers, /idledown:\s*'待机下'/)
  assert.match(renderers, /item:\s*'开心'/)
  assert.match(v8Css, /\.gallery-card \.gcard-preview\s*\{[\s\S]*--gallery-preview-zoom:\s*220px[\s\S]*align-items:\s*flex-end[\s\S]*overflow:\s*hidden/)
  assert.match(v8Css, /\.gallery-card \.gcard-preview img\s*\{[\s\S]*width:\s*var\(--gallery-preview-zoom\)[\s\S]*height:\s*var\(--gallery-preview-zoom\)[\s\S]*max-width:\s*none[\s\S]*max-height:\s*none[\s\S]*object-fit:\s*contain/)
  assert.match(playablePreview, /const useFixedRegionActions = isFixedRegionActionMode/)
  assert.match(playablePreview, /function drawFixedRegionInspectionFrame/)
  assert.match(playablePreview, /job\.inspection_sheet_url/)
  assert.match(playablePreview, /job\.inspection_index_url/)
  assert.match(playablePreview, /drawFixedRegionInspectionFrame\(ctx,\s*preview,\s*timestamp\)\s*\|\|\s*drawFixedRegionSourceFrame\(ctx,\s*preview,\s*timestamp\)/)
  assert.match(playablePreview, /useFixedRegionActions && !inspectionPreview\.image && job\.source_url/)
  assert.match(playablePreview, /if \(!useFixedRegionActions\)/)
  assert.doesNotMatch(playablePreview, /\bfixedRegionActions\b/)
  assert.match(providerStatus, /initProviderConfigSurface/)
  assert.match(providerStatus, /\bruntime_configured\b/)
  assert.doesNotMatch(providerStatus, /activePreset\?\.label|provider\.model\}/)
  assert.match(providerConfig, /\/api\/provider-config/)
  assert.match(providerConfig, /\/api\/gemini-state/)
  assert.match(providerConfig, /CUSTOM_COMPATIBLE_PROVIDER/)
  assert.match(providerConfig, /baseUrl:/)
  assert.match(providerConfig, /Base URL is required for compatible API/)
  assert.match(providerConfig, /input\.type = visible \? 'text' : 'password'/)
  assert.match(workflow, /#character-pack-form > \[data-track\]/)
})

test('character pack release-block predicate handles terminal and stale-evidence cases', () => {
  assert.equal(isCharacterPackReleaseBlocked({ status: 'failed_quality_gate' }), true)
  assert.equal(isCharacterPackReleaseBlocked({ status: 'done', release_ready: false }), true)
  assert.equal(isCharacterPackReleaseBlocked({ status: 'done', artifact_disposition: 'diagnostic_only' }), true)
  assert.equal(
    isCharacterPackReleaseBlocked({
      status: 'done',
      candidate_selection: { release_ready: false, artifact_disposition: 'diagnostic_only' },
    }),
    true
  )
  assert.equal(
    isCharacterPackReleaseBlocked({
      status: 'done',
      release_ready: true,
      artifact_disposition: 'release',
      candidate_selection: { release_ready: false, artifact_disposition: 'diagnostic_only' },
    }),
    true,
    'conflicting release evidence fails closed'
  )
  assert.equal(isCharacterPackReleaseBlocked({ status: 'done' }), false, 'legacy completed jobs remain compatible')
  const canonicalRelease = {
    status: 'done',
    release_ready: true,
    artifact_disposition: 'release',
    release_gate: {
      schema_version: 1,
      mode: 'generation_release_gate_v1',
      generation_mode: 'production_sheet_v0',
      policy: 'strict_live_generation_v1',
      status: 'pass',
      release_ready: true,
      blocking_errors: [],
      warnings: [],
      evidence: {},
    },
  }
  assert.equal(isCharacterPackReleaseBlocked(canonicalRelease), false)
  assert.equal(isCharacterPackReleaseBlocked({
    ...canonicalRelease,
    release_gate: { ...canonicalRelease.release_gate, schema_version: 2 },
  }), true)
  assert.equal(isCharacterPackReleaseBlocked({
    ...canonicalRelease,
    release_gate: { ...canonicalRelease.release_gate, mode: 'unknown_gate' },
  }), true)
  assert.equal(isCharacterPackReleaseBlocked({
    ...canonicalRelease,
    release_gate: { ...canonicalRelease.release_gate, blocking_errors: ['blocked'] },
  }), true)
})

test('2.5D tab exposes reserved provider config for source benchmark', async () => {
  const html = await readFile('index.html', 'utf8')
  const tilesetTab = await readFile('src/ui/twoPointFiveDTilesetTab.js', 'utf8')

  assert.match(html, /id="tileset-runtime-provider"[\s\S]*value="openrouter_compatible"/)
  assert.match(html, /id="tileset-benchmark-description"/)
  assert.match(html, /id="tileset-benchmark-candidate-count"[\s\S]*value="4" selected/)
  assert.match(html, /id="tileset-benchmark-image-size"[\s\S]*value="1K" selected/)
  assert.match(html, /id="tileset-benchmark-max-calls"[^>]*value="4"/)
  assert.match(html, /id="tileset-benchmark-confirm-live"[^>]*type="checkbox"/)
  assert.match(html, /id="tileset-plan-benchmark"/)
  assert.match(html, /id="tileset-run-benchmark"/)
  assert.match(html, /id="tileset-benchmark-result-status"/)
  assert.match(html, /id="tileset-benchmark-links"/)
  assert.match(html, /id="tileset-runtime-model"/)
  assert.match(html, /id="tileset-runtime-base-url-field"[^>]*hidden[\s\S]*id="tileset-runtime-base-url"/)
  assert.match(html, /id="tileset-runtime-api-key"[^>]*type="password"/)
  assert.match(html, /id="tileset-toggle-api-key"[^>]*aria-label="Show API key"/)
  assert.match(html, /id="tileset-save-provider-config"/)
  assert.match(html, /id="tileset-clear-provider-config"/)
  assert.match(html, /id="tileset-provider-config-status"/)
  assert.match(html, /id="tileset-provider-state"/)
  assert.match(tilesetTab, /initProviderConfigSurface/)
  assert.match(tilesetTab, /#tileset-save-provider-config/)
  assert.match(tilesetTab, /planTwoPointFiveDMaterialSourceBenchmark/)
  assert.match(tilesetTab, /runTwoPointFiveDMaterialSourceBenchmark/)
  assert.match(tilesetTab, /buildTwoPointFiveDMaterialSourceBenchmarkReview/)
  assert.match(tilesetTab, /materialSourceBenchmarkReviewCore\.js/)
  assert.doesNotMatch(tilesetTab, /materialSourceBenchmarkReview\.js/)
  assert.match(tilesetTab, /tileset-review-decision/)
  assert.match(tilesetTab, /tileset-review-case-list/)
  assert.match(tilesetTab, /tileset-review-issue-list/)
  assert.match(tilesetTab, /#tileset-benchmark-confirm-live/)
  assert.match(tilesetTab, /maxProviderCalls/)
  assert.match(tilesetTab, /fetchProviderState/)
  assert.match(tilesetTab, /buildTwoPointFiveDTileset/)
  assert.doesNotMatch(tilesetTab, /tileset-build[\s\S]{0,240}provider\.available/)
})
