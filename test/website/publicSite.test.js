import assert from 'node:assert/strict'
import { access, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(testDir, '..', '..')
const websiteRoot = path.join(projectRoot, 'website')

async function readWebsiteFile(name) {
  return readFile(path.join(websiteRoot, name), 'utf8')
}

test('public site keeps a standalone static asset boundary', async () => {
  const html = await readWebsiteFile('index.html')
  const localAssets = ['./styles.css', './site.js', 'og.png']

  for (const asset of localAssets) {
    const assetPath = path.join(websiteRoot, asset.replace(/^\.\//, ''))
    await access(assetPath)
    const assetStat = await stat(assetPath)
    assert.equal(assetStat.isFile(), true, `${asset} must resolve to a file`)
  }

  assert.match(html, /href="\.\/styles\.css"/)
  assert.match(html, /src="\.\/site\.js"/)
  assert.match(html, /content="https:\/\/moteweave\.pages\.dev\/og\.png"/)
  assert.match(html, /property="og:image:width" content="1200"/)
  assert.match(html, /property="og:image:height" content="630"/)
  assert.doesNotMatch(html, /\bsrc=["']https?:\/\//i)
  assert.deepEqual(
    [...html.matchAll(/\bhref=["'](https?:\/\/[^"']+)/gi)].map((match) => match[1]),
    ['https://moteweave.pages.dev/'],
  )
})

test('public site does not expose hosted product capabilities', async () => {
  const [html, script] = await Promise.all([
    readWebsiteFile('index.html'),
    readWebsiteFile('site.js'),
  ])
  const combined = `${html}\n${script}`

  assert.doesNotMatch(html, /<input\b[^>]*\btype=["']file["']/i)
  assert.doesNotMatch(html, /<form\b/i)
  assert.doesNotMatch(
    script,
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/,
  )
  assert.match(combined, /不接收文件/)
  assert.match(combined, /不调用模型/)
  assert.match(combined, /网页未提供/)
  assert.match(combined, /用户文件上传与云端处理/)
})

test('public copy avoids restricted branding and unsupported release claims', async () => {
  const publicFiles = await Promise.all(
    ['index.html', 'styles.css', 'site.js', 'README.md', '_headers'].map(readWebsiteFile),
  )
  const combined = publicFiles.join('\n')
  const restrictedBranding = [
    'Ronin',
    'FrameRonin',
    'PixelLab',
    'Pixelab',
    'PXL',
    'Aseprite Plugin',
    'Aseprite Plus',
    'Spine Compatible',
    'Spine Pro',
    'Scenario Clone',
    'Scenario AI',
    'OCAD Pro',
    'Pro Template',
  ]

  for (const restrictedName of restrictedBranding) {
    assert.equal(
      combined.includes(restrictedName),
      false,
      `public site must not use restricted branding: ${restrictedName}`,
    )
  }

  for (const unsupportedClaim of ['立即在线生成', '免费在线使用', '生产级场景生成']) {
    assert.equal(
      combined.includes(unsupportedClaim),
      false,
      `public site must not claim unsupported capability: ${unsupportedClaim}`,
    )
  }
})

test('public page includes baseline accessibility and capability truth', async () => {
  const [html, css] = await Promise.all([
    readWebsiteFile('index.html'),
    readWebsiteFile('styles.css'),
  ])
  const h1Count = (html.match(/<h1\b/g) ?? []).length

  assert.equal(h1Count, 1)
  assert.match(html, /<html lang="zh-CN">/)
  assert.match(html, /name="viewport"/)
  assert.match(html, /<main id="main-content">/)
  assert.match(html, /class="skip-link"/)
  assert.match(html, /aria-live="polite"/)
  assert.match(css, /prefers-reduced-motion/)
  assert.match(html, /完整 WFC/)
  assert.match(html, /AI 生成只是可选路径/)
  assert.match(html, /MoteWeave/)
  assert.match(html, /0\.5\.0-preview\.1/)
})

test('site script parses and security headers block network and form actions', async () => {
  const [script, headers] = await Promise.all([
    readWebsiteFile('site.js'),
    readWebsiteFile('_headers'),
  ])

  assert.doesNotThrow(() => new Function(script))
  assert.match(headers, /connect-src 'none'/)
  assert.match(headers, /form-action 'none'/)
  assert.match(headers, /frame-ancestors 'none'/)
  assert.match(headers, /Permissions-Policy:/)
})
