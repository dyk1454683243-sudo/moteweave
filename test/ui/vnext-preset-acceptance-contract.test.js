// The VNext preset acceptance contract against the real local service: the VNext client's own
// review, start, job reads and acceptance requests go to a spawned server.js (its real review,
// generation, artifact and acceptance code), with a local fake provider endpoint. No real provider
// is called. Artifacts are written to the repository's generated/ directory, as the other
// server.js tests do.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import test from 'node:test'

import { postStrictManualAcceptance, prepareStrictManualAcceptanceEvidence } from '../../src/ui/studio/characterApi.js'
import { createVnextGenerationClient, vnextAcceptRequest } from '../../src/ui/vnext/vnext-generation-client.js'

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}

async function fakeProvider(png) {
  const requests = []
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    requests.push(req.url)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] } }] }))
  })
  const port = await listen(server)
  return { server, requests, url: `http://127.0.0.1:${port}/v1beta` }
}

async function startServer(providerUrl) {
  const probe = http.createServer()
  const port = await listen(probe)
  probe.close()
  await once(probe, 'close')
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      VNEXT_CONTRACT_TEST_KEY: 'test-only-key',
      CHARACTER_PROVIDER_PRESETS: JSON.stringify([{ id: 'vnext-contract-gemini', provider: 'gemini', apiKeyEnv: 'VNEXT_CONTRACT_TEST_KEY',
        model: 'gemini-3.1-flash-image-preview', baseUrl: providerUrl, image_size: '2K', aspect_ratio: '1:1' }]),
      CHARACTER_DEFAULT_PROVIDER: 'vnext-contract-gemini',
      CHARACTER_JOB_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await new Promise((resolve, reject) => {
    let output = ''
    const onData = chunk => { output += chunk; if (output.includes('Character tool running')) resolve() }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('exit', code => reject(new Error(`server exited before ready: ${code}\n${output}`)))
  })
  const base = `http://127.0.0.1:${port}`
  const fetchImpl = (url, init) => fetch(new URL(url, base), init)
  return { child, base, fetchImpl, client: createVnextGenerationClient({ fetchImpl }) }
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  await once(child, 'exit')
}

test('VNext accepts a real review-required preset job with an artifact-verified request; the old job-field request is rejected', async (t) => {
  const png = await readFile(new URL('../../templates/motion_template_ocad_primary.png', import.meta.url))
  const provider = await fakeProvider(png)
  t.after(() => provider.server.close())
  let app = await startServer(provider.url)
  t.after(() => stop(app.child))

  // The VNext client's own requests: provider-free review, the one live call, job reads.
  const review = await app.client.reviewCharacter({ description: 'one original compact forest ranger' })
  assert.equal(provider.requests.length, 0)
  const started = await app.client.startGenerate(review)
  let job = await app.client.getJob(started.id)
  for (let i = 0; i < 240 && !['done', 'failed_quality_gate', 'failed_post_processing', 'failed_model_error', 'failed_safety_filter'].includes(job.status); i++) {
    await new Promise(resolve => setTimeout(resolve, 25))
    job = await app.client.getJob(started.id)
  }
  assert.equal(job.status, 'done')
  assert.equal(job.human_decision_status, 'pending')
  assert.equal(provider.requests.length, 1)

  // The defect: the job record has no plan or artifact hashes, so a request built from its fields
  // (the former buildAcceptPayload) is rejected by the real acceptance validation.
  const legacy = await fetch(new URL(`/api/generate-character/${job.id}/accept`, app.base), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmManualAcceptance: true, expectedPlanHash: job.plan_hash ?? null,
      expectedReferenceManifestSha256: job.reference_manifest_sha256 ?? null, expectedRawProviderOutputSha256: job.raw_provider_output_sha256 ?? null,
      expectedBackgroundRemovedProviderOutputSha256: job.background_removed_provider_output_sha256 ?? null,
      expectedSourceSha256: job.source_sha256 ?? null, expectedNormalizedSheetSha256: job.normalized_sheet_sha256 ?? null,
      humanReviewedIssueCount: 0, acceptanceBasis: 'user_request' }),
  })
  assert.equal(legacy.status, 400)
  assert.equal((await legacy.json()).error, 'invalid_acceptance_request')

  // The repair: the request carries the sealed review and the verified artifact hashes; the server
  // checks them again and publishes once, recording the request as the basis.
  const accepted = await app.client.acceptJob(job.id)
  assert.equal(accepted.saved, 'accepted')
  assert.equal(accepted.publication_id, `accepted_v1_${job.id}`)
  assert.equal(accepted.provider_call_budget?.used_provider_calls, 0)
  assert.match(String(accepted.source_url), new RegExp(`^/generated/accepted_v1_${job.id}/source\\.png$`))
  const record = await (await fetch(new URL(`/generated/accepted_v1_${job.id}/manual_acceptance.json`, app.base))).json()
  assert.equal(record.acceptance_basis, 'user_request')
  assert.equal(record.human_reviewed_issue_count, 0)
  assert.equal(record.source_job_id, job.id)
  // A repeated acceptance is a replay of the same publication, not a second one.
  const replay = await app.client.acceptJob(job.id)
  assert.equal(replay.saved, 'already_accepted')
  assert.equal(replay.source_url, accepted.source_url)
  assert.equal(provider.requests.length, 1, 'acceptance never calls the provider')

  // After a restart the service no longer holds the job: VNext rebuilds it from its saved files
  // (the same strict restore Studio uses) and the acceptance still replays; nothing is generated.
  await stop(app.child)
  app = await startServer(provider.url)
  assert.deepEqual(await app.client.getJob(job.id), { status: 'not_found' })
  const restored = await app.client.restoreGenerationJob(job.id)
  assert.equal(restored.job.id, job.id)
  assert.equal(restored.job.human_decision_status, 'pending')
  assert.equal(restored.review.reviewed_run_id, review.reviewed_run_id)
  assert.equal(restored.review.plan_hash, review.plan_hash)
  assert.equal(restored.description, 'one original compact forest ranger', 'the sealed request text, for the restored conversation')
  const afterRestart = await app.client.acceptJob(job.id)
  assert.equal(afterRestart.saved, 'already_accepted')
  assert.equal(afterRestart.source_url, accepted.source_url)
  assert.equal(provider.requests.length, 1)

  // A Job ID with no saved files is missing; a check that cannot complete is not.
  assert.deepEqual(await app.client.restoreGenerationJob(`job_vnext_contract_missing_${process.pid}`), { missing: true })
  await assert.rejects(app.client.acceptJob(`job_vnext_contract_missing_${process.pid}`), error => error.code === 'job_not_found')
  const unanswered = createVnextGenerationClient({ fetchImpl: async () => { throw new TypeError('fetch failed') } })
  await assert.rejects(unanswered.restoreGenerationJob(job.id), error => error instanceof TypeError)

  // A job accepted in Studio with reviewed issues: VNext's own request (issue count 0, request basis)
  // conflicts with that publication, so Finish processing replays the values it recorded instead.
  const review2 = await app.client.reviewCharacter({ description: 'one original compact desert scout' })
  const started2 = await app.client.startGenerate(review2)
  let job2 = await app.client.getJob(started2.id)
  for (let i = 0; i < 240 && !['done', 'failed_quality_gate', 'failed_post_processing', 'failed_model_error', 'failed_safety_filter'].includes(job2.status); i++) {
    await new Promise(resolve => setTimeout(resolve, 25))
    job2 = await app.client.getJob(started2.id)
  }
  assert.equal(job2.status, 'done')
  assert.equal(provider.requests.length, 2)
  const pending2 = await app.client.restoreGenerationJob(job2.id)
  const studio = await prepareStrictManualAcceptanceEvidence({ job: pending2.job, review: pending2.review, humanReviewedIssueCount: 2 }, { fetchImpl: app.fetchImpl })
  const studioAccepted = await postStrictManualAcceptance(job2.id, studio.acceptanceBody, { fetchImpl: app.fetchImpl })
  assert.equal(studioAccepted.saved, 'accepted')
  const own = await prepareStrictManualAcceptanceEvidence({ job: pending2.job, review: pending2.review, humanReviewedIssueCount: 0 }, { fetchImpl: app.fetchImpl })
  const conflicting = await fetch(new URL(`/api/generate-character/${job2.id}/accept`, app.base), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(vnextAcceptRequest(own.acceptanceBody)) })
  assert.equal(conflicting.status, 409, 'a new request with different reviewed values is refused by the publication')
  const replayed = await app.client.acceptJob(job2.id)
  assert.equal(replayed.saved, 'already_accepted')
  assert.equal(replayed.source_url, studioAccepted.source_url)
  const record2 = await (await fetch(new URL(`/generated/accepted_v1_${job2.id}/manual_acceptance.json`, app.base))).json()
  assert.equal(record2.human_reviewed_issue_count, 2, 'the publication keeps what Studio recorded')
  assert.equal(record2.acceptance_basis, undefined)
  assert.equal(provider.requests.length, 2, 'acceptance never calls the provider')
})
