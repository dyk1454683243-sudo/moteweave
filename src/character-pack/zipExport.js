import JSZip from 'jszip'

export async function buildCharacterPackZip(files) {
  const zip = new JSZip()
  for (const [name, value] of Object.entries(files)) {
    zip.file(name, Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2))
  }
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}
