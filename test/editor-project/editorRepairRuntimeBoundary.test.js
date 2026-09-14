import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => reject(new Error(`server did not start: ${output}`)), 8000)
    const onData = (chunk) => {
      output += chunk.toString()
      if (!output.includes('Character tool running')) return
      clearTimeout(timeout)
      child.off('exit', onExit)
      resolve()
    }
    const onExit = (code) => {
      clearTimeout(timeout)
      reject(new Error(`server exited before static boundary test: ${code}\n${output}`))
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', (chunk) => { output += chunk.toString() })
    child.once('exit', onExit)
  })
}

async function stopServer(child) {
  if (child.exitCode != null || child.signalCode != null) return
  child.kill('SIGTERM')
  const timeout = setTimeout(() => child.kill('SIGKILL'), 3000)
  try {
    await once(child, 'exit')
  } finally {
    clearTimeout(timeout)
  }
}

test('server does not wire the retired single-frame provider repair service', async () => {
  const source = await readFile(new URL('../../server.js', import.meta.url), 'utf8')
  assert.equal((source.match(/createJobQueue\s*\(/g) ?? []).length, 2)
  assert.match(source, /const jobQueue = createJobQueue\(\{ concurrency: process\.env\.CHARACTER_JOB_CONCURRENCY \|\| 2 \}\)/)
  assert.match(source, /const motionMediaQueue = createJobQueue\(\{ concurrency: 1 \}\)/)
  assert.equal((source.match(/createFrameRepairOperationLedger\s*\(/g) ?? []).length, 0)
  assert.equal((source.match(/createFrameRepairService\s*\(/g) ?? []).length, 0)
  assert.equal((source.match(/createFrameRepairCoordinator\s*\(/g) ?? []).length, 0)
  assert.doesNotMatch(source, /requestFrameRepairCandidate|normalizeFrameRepairCandidate|compositeFrameRepairCandidate/)
  assert.doesNotMatch(source, /frameRepairCoordinator,|frameRepairService,|frameRepairQualityGateCoordinator,/)
  assert.doesNotMatch(source, /requestGeminiPromptImage|requestOpenRouterPromptImage/)
  assert.match(source, /repairCharacterAction:\s*handleRepairCharacterAction/)
  assert.match(source, /server\.listen\(port,\s*'127\.0\.0\.1'/)
  assert.doesNotMatch(source, /pathname\.slice\(1\)[\s\S]{0,200}createReadStream/)
})

test('server static allowlist exposes generated artifacts but never repository or workspace secrets', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'frame-repair-static-boundary-'))
  const workspaceRoot = path.join(root, 'workspace')
  const privatePath = path.join(
    workspaceRoot,
    '.operations',
    'frame-repair',
    `${'a'.repeat(64)}.json`,
  )
  await mkdir(path.dirname(privatePath), { recursive: true })
  await writeFile(privatePath, '{"private":true}\n')
  const publicName = `frame-repair-static-${process.pid}-${Date.now()}.txt`
  const publicPath = path.join(process.cwd(), 'generated', publicName)
  const symlinkName = `${publicName}.link`
  const symlinkPath = path.join(process.cwd(), 'generated', symlinkName)
  await writeFile(publicPath, 'public generated evidence')
  await symlink(privatePath, symlinkPath)
  const port = await getFreePort()
  const child = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      EDITOR_WORKSPACE_ROOT: workspaceRoot,
      CHARACTER_JOB_CONCURRENCY: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    await waitForServer(child)
    const baseUrl = `http://127.0.0.1:${port}`
    const generated = await fetch(`${baseUrl}/generated/${publicName}`)
    assert.equal(generated.status, 200)
    assert.equal(await generated.text(), 'public generated evidence')
    const source = await fetch(`${baseUrl}/src/v8.css`)
    assert.equal(source.status, 200)
    const editor = await fetch(`${baseUrl}/editor`)
    assert.equal(editor.status, 200)
    for (const pathname of [
      '/package.json',
      '/.env',
      `/workspace/.operations/frame-repair/${'a'.repeat(64)}.json`,
      '/src/%2e%2e%2fpackage.json',
      `/generated/${symlinkName}`,
    ]) {
      const response = await fetch(`${baseUrl}${pathname}`)
      assert.equal(response.status, 404, pathname)
    }
  } finally {
    await stopServer(child)
    await unlink(symlinkPath)
    await unlink(publicPath)
  }
})
