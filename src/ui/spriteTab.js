import { buildSpriteIndex, normalizeExportParams } from '../pixelPipeline.js'
import { state } from './appState.js'
import { $, canvasToBlob, downloadBlob, fileToBase64, loadImage, showToast } from './dom.js'

function readParams() {
  return normalizeExportParams({
    targetW: $('#target-w').value,
    targetH: $('#target-h').value,
    padding: $('#padding').value,
    spacing: $('#spacing').value,
    columns: $('#columns').value,
    fps: $('#fps').value,
  })
}

function updateMetrics() {
  const params = readParams()
  const index = buildSpriteIndex({
    frameCount: state.frames.length,
    targetW: params.targetW,
    targetH: params.targetH,
    spacing: params.spacing,
    columns: params.columns,
    fps: params.fps,
  })
  const rows = state.frames.length ? Math.ceil(state.frames.length / params.columns) : 0
  $('#sheet-metrics').innerHTML = [
    `<span>帧：${state.frames.length}</span>`,
    `<span>画布：${index.sheet_size.w} x ${index.sheet_size.h}</span>`,
    `<span>行：${rows}</span>`,
  ].join('')
}

async function buildFrameGif(files, params) {
  const framesBase64 = []
  for (const frame of files) framesBase64.push(await fileToBase64(frame.file))
  const response = await fetch('/api/build-frame-gif', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      frames_base64: framesBase64,
      options: {
        targetW: params.targetW,
        targetH: params.targetH,
        padding: params.padding,
        fps: params.fps,
      },
    }),
  })
  if (!response.ok) throw new Error(`GIF 生成失败：${response.status}`)
  return response.blob()
}

function clearGifPreview() {
  if (state.gifUrl) URL.revokeObjectURL(state.gifUrl)
  state.gifBlob = null
  state.gifUrl = null
  $('#sprite-gif-preview-card').hidden = true
  $('#sprite-gif-preview').removeAttribute('src')
  $('#download-gif').disabled = true
}

function setGifPreview(blob) {
  clearGifPreview()
  state.gifBlob = blob
  state.gifUrl = URL.createObjectURL(blob)
  $('#sprite-gif-preview').src = state.gifUrl
  $('#sprite-gif-preview-card').hidden = false
  $('#download-gif').disabled = false
}

async function loadFrames(files) {
  state.frames.forEach((frame) => URL.revokeObjectURL(frame.url))
  const sortedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }))
  state.frames = []
  for (const file of sortedFiles) {
    const { image, url } = await loadImage(file)
    state.frames.push({ file, image, url })
  }
  state.sheetBlob = null
  clearGifPreview()
  state.index = null
  renderFrameList()
  updateMetrics()
  updateDownloads(false)
  $('#status-line').textContent = state.frames.length ? `已载入 ${state.frames.length} 帧` : '等待上传帧'
}

function renderFrameList() {
  const list = $('#frame-list')
  list.innerHTML = ''
  state.frames.forEach((frame, index) => {
    const item = document.createElement('li')
    item.innerHTML = `<span>${index + 1}</span><strong>${frame.file.name}</strong><small>${frame.image.width} x ${frame.image.height}</small>`
    list.append(item)
  })
}

function drawFrame(ctx, image, frame, params) {
  const innerW = Math.max(1, params.targetW - params.padding * 2)
  const innerH = Math.max(1, params.targetH - params.padding * 2)
  const scale = Math.min(innerW / image.width, innerH / image.height, 1)
  const width = Math.max(1, Math.round(image.width * scale))
  const height = Math.max(1, Math.round(image.height * scale))
  const x = frame.x + params.padding + Math.round((innerW - width) / 2)
  const y = frame.y + params.padding + Math.round((innerH - height) / 2)
  ctx.drawImage(image, x, y, width, height)
}

async function generateSheet() {
  if (!state.frames.length) {
    showToast('请先上传序列帧')
    return
  }
  const params = readParams()
  const index = buildSpriteIndex({
    frameCount: state.frames.length,
    targetW: params.targetW,
    targetH: params.targetH,
    spacing: params.spacing,
    columns: params.columns,
    fps: params.fps,
  })
  const canvas = $('#sheet-canvas')
  canvas.width = Math.max(1, index.sheet_size.w)
  canvas.height = Math.max(1, index.sheet_size.h)
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = false
  index.frames.forEach((frame, i) => drawFrame(ctx, state.frames[i].image, frame, params))
  state.index = index
  state.sheetBlob = await canvasToBlob(canvas)
  updateDownloads(true)
  updateMetrics()
  $('#status-line').textContent = `已生成 ${index.sheet_size.w} x ${index.sheet_size.h}，正在生成 GIF...`
  try {
    setGifPreview(await buildFrameGif(state.frames, params))
    $('#status-line').textContent = `已生成 ${index.sheet_size.w} x ${index.sheet_size.h} + GIF`
    showToast('Sprite Sheet 和 GIF 已生成')
  } catch (error) {
    clearGifPreview()
    $('#status-line').textContent = `已生成 ${index.sheet_size.w} x ${index.sheet_size.h}，GIF 失败`
    showToast(error.message)
  }
}

function updateDownloads(enabled) {
  $('#download-png').disabled = !enabled
  $('#download-json').disabled = !enabled
  $('#download-gif').disabled = !state.gifBlob
  $('#download-zip').disabled = !enabled
}

async function blobToBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer())
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function writeUint16(target, offset, value) {
  target[offset] = value & 0xff
  target[offset + 1] = (value >>> 8) & 0xff
}

function writeUint32(target, offset, value) {
  target[offset] = value & 0xff
  target[offset + 1] = (value >>> 8) & 0xff
  target[offset + 2] = (value >>> 16) & 0xff
  target[offset + 3] = (value >>> 24) & 0xff
}

function concatBytes(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  chunks.forEach((chunk) => {
    out.set(chunk, offset)
    offset += chunk.length
  })
  return out
}

function makeZip(files) {
  const encoder = new TextEncoder()
  const localParts = []
  const centralParts = []
  let offset = 0
  files.forEach((file) => {
    const name = encoder.encode(file.name)
    const data = file.data
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length)
    writeUint32(local, 0, 0x04034b50)
    writeUint16(local, 4, 20)
    writeUint16(local, 6, 0x0800)
    writeUint16(local, 8, 0)
    writeUint32(local, 10, 0)
    writeUint32(local, 14, crc)
    writeUint32(local, 18, data.length)
    writeUint32(local, 22, data.length)
    writeUint16(local, 26, name.length)
    local.set(name, 30)
    localParts.push(local, data)

    const central = new Uint8Array(46 + name.length)
    writeUint32(central, 0, 0x02014b50)
    writeUint16(central, 4, 20)
    writeUint16(central, 6, 20)
    writeUint16(central, 8, 0x0800)
    writeUint16(central, 10, 0)
    writeUint32(central, 12, 0)
    writeUint32(central, 16, crc)
    writeUint32(central, 20, data.length)
    writeUint32(central, 24, data.length)
    writeUint16(central, 28, name.length)
    writeUint32(central, 42, offset)
    central.set(name, 46)
    centralParts.push(central)
    offset += local.length + data.length
  })

  const centralDirectory = concatBytes(centralParts)
  const end = new Uint8Array(22)
  writeUint32(end, 0, 0x06054b50)
  writeUint16(end, 8, files.length)
  writeUint16(end, 10, files.length)
  writeUint32(end, 12, centralDirectory.length)
  writeUint32(end, 16, offset)
  return new Blob([concatBytes(localParts), centralDirectory, end], { type: 'application/zip' })
}

async function downloadZip() {
  if (!state.sheetBlob || !state.index) return
  const json = new Blob([JSON.stringify(state.index, null, 2)], { type: 'application/json' })
  const zip = makeZip([
    { name: 'sprite.png', data: await blobToBytes(state.sheetBlob) },
    { name: 'index.json', data: await blobToBytes(json) },
    ...(state.gifBlob ? [{ name: 'preview.gif', data: await blobToBytes(state.gifBlob) }] : []),
  ])
  downloadBlob(zip, 'sprite_sheet.zip')
}

export function initSpriteTab() {
  updateMetrics()
  $('#frame-files').addEventListener('change', async (event) => {
    try {
      await loadFrames(event.target.files)
    } catch (error) {
      showToast(error.message)
    }
  })
  $('#sprite-form').addEventListener('input', updateMetrics)
  $('#generate-sheet').addEventListener('click', generateSheet)
  $('#download-png').addEventListener('click', () => state.sheetBlob && downloadBlob(state.sheetBlob, 'sprite.png'))
  $('#download-json').addEventListener('click', () => {
    if (!state.index) return
    downloadBlob(new Blob([JSON.stringify(state.index, null, 2)], { type: 'application/json' }), 'index.json')
  })
  $('#download-gif').addEventListener('click', () => state.gifBlob && downloadBlob(state.gifBlob, 'preview.gif'))
  $('#download-zip').addEventListener('click', downloadZip)
}
