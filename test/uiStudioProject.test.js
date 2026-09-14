import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { getStudioCharacterProjectCandidate } from '../src/ui/studio/characterView.js'
import {
  PROJECT_COPY,
  PROJECT_PHASES,
  createInitialProjectState,
  deriveProjectPresentation,
  projectResultIsCurrent,
} from '../src/ui/studio/projectView.js'
import { getStudioSceneProjectCandidate } from '../src/ui/studio/sceneView.js'

function openingTagForId(html, id) {
  return html.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>`))?.[0] ?? ''
}

function projectHtml(html) {
  const start = html.indexOf('id="studio-project-view"')
  const end = html.indexOf('id="studio-qa-view"', start)
  assert.ok(start >= 0 && end > start, 'Studio Project view is missing')
  return html.slice(start, end)
}

test('Project Studio owns the Current Figma route without exposing the retired workspace link', async () => {
  const [html, app] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/app.js', 'utf8'),
  ])
  const opening = openingTagForId(html, 'studio-project-view')
  assert.match(opening, /data-studio-view="project"[^>]*data-project-phase="empty"[^>]*data-design-source="figma:ro8w6TKkpd969zW2V5bmkx\/646:3692"[^>]*hidden/)
  assert.match(html, /href="#project" data-studio-route="project"/)
  assert.match(app, /import \{ initStudioProject, renderStudioProjectLanguage \} from '\.\/projectView\.js'/)
  assert.match(app, /\['character', 'action', 'sequence', 'tiles', 'scene', 'project', 'qa', 'settings'\]/)
  assert.match(app, /project: 'MoteWeave · 项目包'/)
  assert.match(app, /project: 'MoteWeave · Project Pack'/)
  assert.match(app, /else if \(activeRoute === 'project'\) renderStudioProjectLanguage\(\)/)
  assert.match(app, /projectInitializationPromise = Promise\.resolve\(initStudioProject\(\{ serviceAvailable \}\)\)/)
  assert.match(html, /\['character', 'action', 'sequence', 'tiles', 'scene', 'project', 'qa', 'settings'\]\.includes\(requestedRoute\)/)
  assert.doesNotMatch(projectHtml(html), /href="\/legacy\?tab=project-pack"|project-legacy-link|legacyLink/)
  assert.doesNotMatch(opening, /221:2189|56:1916|60:164/, 'Archive and old editor frames are reference-only')
})

test('Project Studio exposes the complete truthful state matrix without fake history or editor controls', async () => {
  const [html, view, api] = await Promise.all([
    readFile('src/ui/studio/studio.html', 'utf8'),
    readFile('src/ui/studio/projectView.js', 'utf8'),
    readFile('src/ui/studio/projectApi.js', 'utf8'),
  ])
  const project = projectHtml(html)
  assert.deepEqual(PROJECT_PHASES, [
    'empty', 'ready', 'running', 'complete', 'failed', 'poll_paused', 'stale', 'submission_unknown',
  ])
  for (const phase of PROJECT_PHASES) {
    assert.match(view, new RegExp(`['"]${phase}['"]`))
  }
  assert.deepEqual(Object.keys(PROJECT_COPY.zh).sort(), Object.keys(PROJECT_COPY.en).sort())
  const copyKeys = new Set(Object.keys(PROJECT_COPY.en))
  for (const match of project.matchAll(/data-project-copy(?:-placeholder|-aria-label|-title)?="([^"]+)"/g)) {
    assert.ok(copyKeys.has(match[1]), `missing Project copy key: ${match[1]}`)
  }
  for (const match of view.matchAll(/projectT\('([^']+)'/g)) {
    assert.ok(copyKeys.has(match[1]), `missing dynamic Project copy key: ${match[1]}`)
  }
  assert.doesNotMatch(project, /type="search"|hero_knight|job_0842|grove_scene|recent jobs|最近任务/i)
  assert.doesNotMatch(project, /<(?:button|a)[^>]*(?:repair|修复|cancel|重试|retry|AI 生成|地图编辑)/i)
  assert.doesNotMatch(project, /Provider preset|模型选择|导出引擎/i)
  assert.match(api, /'\/api\/project-pack'/)
  assert.match(api, /`\/api\/jobs\/\$\{observedJobId\}`/)
  assert.doesNotMatch(api, /generate-character|generate-scene-tiles|process-scene-tiles/)
  assert.match(view, /state\.phase = 'submission_unknown'/)
  assert.match(view, /state\.phase = 'poll_paused'/)
  assert.match(view, /state\.phase = 'stale'/)
  assert.match(view, /projectObservationCanResume\(error\)[\s\S]*state\.phase = 'poll_paused'/)

  const exportTag = openingTagForId(project, 'studio-project-export')
  assert.match(exportTag, /aria-disabled="true"/)
  assert.doesNotMatch(exportTag, /\bhref=/)
  assert.match(openingTagForId(project, 'studio-project-primary'), /\bdisabled\b/)
  assert.match(openingTagForId(project, 'studio-project-strict-style'), /type="checkbox"/)
  assert.doesNotMatch(openingTagForId(project, 'studio-project-strict-style'), /\bchecked\b|\bdisabled\b/)
  assert.equal((project.match(/type="checkbox" checked disabled/g) ?? []).length, 2)
  assert.doesNotMatch(project, /project-open-directory|打开输出目录|Open output directory/)
  assert.equal(getStudioCharacterProjectCandidate(), null)
  assert.equal(getStudioSceneProjectCandidate(), null)
})

test('Project state gates new submission, same-Job resume, stale output, and verified release', () => {
  const fileMode = createInitialProjectState({ serviceAvailable: false })
  fileMode.inputsValid = true
  fileMode.phase = 'ready'
  assert.equal(deriveProjectPresentation(fileMode).action, 'blocked')

  const state = createInitialProjectState()
  assert.equal(deriveProjectPresentation(state).action, 'blocked')
  state.inputsValid = true
  state.inputsKey = 'binding-1'
  state.phase = 'ready'
  assert.equal(deriveProjectPresentation(state).action, 'build')
  state.phase = 'running'
  state.busy = 'polling'
  assert.equal(deriveProjectPresentation(state).action, 'blocked')
  state.busy = null
  state.phase = 'poll_paused'
  state.job = { id: 'job_project_1' }
  state.binding = { inputs: state.inputs, inputKey: 'binding-1', jobId: 'job_project_1' }
  assert.equal(deriveProjectPresentation(state).action, 'resume')
  state.phase = 'submission_unknown'
  assert.equal(deriveProjectPresentation(state).action, 'blocked')

  state.phase = 'complete'
  state.resultVerified = true
  state.resultJob = { id: 'job_project_1', status: 'done' }
  assert.equal(projectResultIsCurrent(state), true)
  assert.equal(deriveProjectPresentation(state).releaseReady, true)
  state.inputsKey = 'binding-2'
  assert.equal(projectResultIsCurrent(state), false)
  state.inputsKey = 'binding-1'
  state.phase = 'failed'
  assert.equal(projectResultIsCurrent(state), false)
})

test('Project geometry preserves the 1920 Current frame and has a real narrow layout', async () => {
  const css = await readFile('src/ui/studio/studio.css', 'utf8')
  assert.match(css, /\.project-workspace\s*\{[^}]*grid-template-columns:\s*320px minmax\(0,1fr\)/)
  assert.match(css, /\.project-stage-body\s*\{[^}]*grid-template-rows:\s*minmax\(420px,1fr\) 225px[^}]*gap:\s*16px[^}]*padding:\s*16px/)
  assert.match(css, /\.project-candidate-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)[^}]*gap:\s*16px/)
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.project-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)/)
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.project-topbar \.project-language\s*\{[^}]*display:\s*inline-flex/)
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.project-candidate-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)/)
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.project-result-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)/)
})
