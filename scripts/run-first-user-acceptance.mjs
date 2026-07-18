#!/usr/bin/env node
import { spawn } from 'node:child_process'
import net from 'node:net'

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let output = ''
    const timeout = setTimeout(() => {
      reject(new Error(`first-user acceptance server did not start\n${output}`))
    }, 10_000)
    const onData = (chunk) => {
      const text = chunk.toString()
      output = `${output}${text}`.slice(-16_384)
      process.stdout.write(text)
      if (text.includes('Character tool running')) {
        clearTimeout(timeout)
        resolve()
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      output = `${output}${text}`.slice(-16_384)
      process.stderr.write(text)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      reject(new Error(`first-user acceptance server exited before ready: ${code ?? signal}\n${output}`))
    })
  })
}

function processGroupExists(processGroupId) {
  try {
    process.kill(-processGroupId, 0)
    return true
  } catch (error) {
    if (error?.code === 'ESRCH') return false
    if (error?.code === 'EPERM') return true
    throw error
  }
}

function signalProcessGroup(processGroupId, signal) {
  try {
    process.kill(-processGroupId, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

async function waitForProcessGroupExit(processGroupId, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (processGroupExists(processGroupId) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  return !processGroupExists(processGroupId)
}

async function stopProcessGroup(processGroupId) {
  if (!processGroupId || !processGroupExists(processGroupId)) return
  signalProcessGroup(processGroupId, 'SIGTERM')
  if (await waitForProcessGroupExit(processGroupId, 2_000)) return
  signalProcessGroup(processGroupId, 'SIGKILL')
  if (!await waitForProcessGroupExit(processGroupId, 2_000)) {
    throw new Error(`first-user acceptance process group ${processGroupId} survived SIGKILL`)
  }
}

let serverProcessGroupId = null
let clientProcessGroupId = null
let cleanupPromise = null

function cleanup() {
  cleanupPromise ??= (async () => {
    await stopProcessGroup(clientProcessGroupId)
    await stopProcessGroup(serverProcessGroupId)
  })()
  return cleanupPromise
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(128))
  })
}

try {
  if (process.platform === 'win32') {
    throw new Error('first-user acceptance requires POSIX process-group supervision')
  }
  const port = await freePort()
  const server = spawn(process.execPath, ['server.js'], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      PORT: String(port),
      OPENROUTER_API_KEY: '',
      GEMINI_API_KEY: '',
      GOOGLE_API_KEY: '',
      CHARACTER_IMAGE_API_KEY: '',
      CHARACTER_IMAGE_API_KEY_ENV: '',
      CHARACTER_PROVIDER_PRESETS: '',
      OPENROUTER_PROVIDER_PRESETS: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  serverProcessGroupId = server.pid
  await waitForServer(server)
  const client = spawn(
    process.execPath,
    ['scripts/first-user-acceptance.mjs', '--base-url', `http://127.0.0.1:${port}`],
    {
      cwd: process.cwd(),
      detached: true,
      stdio: 'inherit',
    }
  )
  clientProcessGroupId = client.pid
  const result = await new Promise((resolve) => {
    client.once('exit', (code, signal) => resolve({ code, signal }))
  })
  if (result.code !== 0) {
    throw new Error(`first-user acceptance failed: ${result.code ?? result.signal}`)
  }
} finally {
  await cleanup()
}
