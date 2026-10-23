// A thin local transport. Drawing always executes in GameTool's shared pixel kernel.
import { writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const usage = 'Send JSON on stdin: {action,project_id,session_id?,operation_id?,...}. Actions: create, read_canvas, read_document, read_region, render_review, analyze_pixels, propose_patch, preview_patch, patch_region, draw_pixels, undo_pixels, get_job, cancel_job, request_acceptance, review, close. --url http://127.0.0.1:PORT is required; --image NEW.png optionally saves the returned preview; --describe includes tool schemas. No save/model tool exists.'
const ID = /^[A-Za-z0-9_-]{1,96}$/
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const ALLOWED_ACTIONS = new Set([
  'create', 'read_canvas', 'read_document', 'read_region', 'render_review', 'analyze_pixels',
  'propose_patch', 'preview_patch', 'patch_region', 'draw_pixels', 'undo_pixels',
  'get_job', 'cancel_job', 'request_acceptance', 'review', 'close',
])
export async function runPixelToolsCommand(input, { url, image, describe = false, fetchImpl = fetch, writeImage = writeFile } = {}) {
  const origin = new URL(url)
  if (origin.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
    || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw Error('A local HTTP origin is required')
  if (!input || Array.isArray(input) || !ID.test(input.project_id || '')
    || !ALLOWED_ACTIONS.has(input.action)) throw Error('Invalid command')
  const { action, project_id, session_id, operation_id = randomUUID(), bridge_token, ...args } = input
  if (!UUID.test(operation_id) || (action !== 'create' && !UUID.test(session_id || ''))) throw Error('Invalid operation or session ID')
  const endpoint = `${origin.origin}/api/editor/projects/${project_id}/pixel-tools${action === 'create' ? '' : '/' + session_id}`
  const body = action === 'create'
    ? { ...args, ...(bridge_token !== undefined ? { bridge_token } : {}), operation_id }
    : { operation_id, tool: action, arguments: args, ...(bridge_token !== undefined ? { bridge_token } : {}) }
  try {
    const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10000), redirect: 'error' })
    const length = Number(response.headers.get('content-length'))
    if (length > 128 * 1024) throw Error('Response too large')
    let size = 0, chunks = []
    for await (const chunk of response.body) {
      size += chunk.length
      if (size > 128 * 1024) throw Error('Response too large')
      chunks.push(chunk)
    }
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!response.ok) throw Object.assign(new Error(result.error || 'Request failed'), { code: result.error, diagnostic: result.diagnostic, operation_id })
    if (!describe) delete result.tools
    if (result.review_path) result.review_url = new URL(result.review_path, origin).href
    const observation = result.contentItems?.find(item => item.type === 'inputImage')?.imageUrl
    if (result.contentItems) {
      result.observation = JSON.parse(result.contentItems.find(item => item.type === 'inputText').text)
      delete result.contentItems // Never flood the conversation with base64.
    }
    if (image && observation) {
      if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(observation)) throw Error('Invalid preview image')
      await writeImage(image, Buffer.from(observation.split(',')[1], 'base64'), { flag: 'wx' })
      result.preview_file = image
    }
    return { operation_id, ...result }
  } catch (error) { throw Object.assign(error, { operation_id }) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const argv = process.argv.slice(2), options = {}
    if (argv.includes('--help')) { console.log(usage); process.exit(0) }
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--describe') options.describe = true
      else if (['--url', '--image'].includes(argv[i]) && argv[i + 1]) options[argv[i].slice(2)] = argv[++i]
      else throw Error(usage)
    }
    let input = ''
    for await (const chunk of process.stdin) { input += chunk; if (Buffer.byteLength(input) > 68 * 1024) throw Error('Input too large') }
    console.log(JSON.stringify(await runPixelToolsCommand(JSON.parse(input), options)))
  } catch (error) {
    console.error(JSON.stringify({ error: error.code || error.message, operation_id: error.operation_id, saved: false, retried: false, ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}) }))
    process.exitCode = 1
  }
}
