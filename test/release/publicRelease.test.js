import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  checkPublicRelease,
  exportPublicSnapshot,
  validateExportDestination,
} from '../../scripts/public-release.mjs'

async function writeFixtureFile(root, relativePath, content) {
  const filePath = path.join(root, relativePath)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
  return relativePath
}

async function releaseFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'public-release-check-'))
  const brand = 'MoteWeave'
  const slug = 'moteweave'
  const repositoryUrl = `https://github.com/example/${slug}.git`
  const homepageUrl = `https://${slug}.pages.dev/`
  const files = []
  const add = async (relativePath, content) => {
    files.push(await writeFixtureFile(root, relativePath, content))
  }

  await add('configs/public-release.json', JSON.stringify({
    schema_version: 1,
    release_version: '0.5.0-preview.1',
    source_only: true,
    npm_publish: false,
    privacy: {
      synthetic_home_path_allowlist: [
        {
          path_prefix: 'test/editor-project/',
          users: ['private'],
        },
      ],
    },
    brand: {
      status: 'approved',
      display_name: brand,
      slug,
      github_owner: 'example',
      repository_url: repositoryUrl,
      homepage_url: homepageUrl,
      pages_project: slug,
      decision_file: 'docs/decisions/2026-07-17-public-brand-selection.md',
    },
  }))
  await add('configs/public-snapshot-manifest.json', JSON.stringify({
    schema_version: 1,
    include_paths: [
      '.env.example',
      'AGENTS.md',
      'ATTRIBUTIONS.md',
      'CHANGELOG.md',
      'LICENSE',
      'PUBLIC_SNAPSHOT.json',
      'README.md',
      'configs/',
      'docs/',
      'index.html',
      'package-lock.json',
      'package.json',
      'scripts/',
      'src/',
      'test/',
      'website/',
    ],
    exclude_paths: ['.claude/'],
    forbidden_paths: ['generated/'],
  }))
  await add('configs/public-asset-provenance.json', JSON.stringify({
    schema_version: 1,
    assets: [],
  }))
  await add('package.json', JSON.stringify({
    name: slug,
    version: '0.5.0-preview.1',
    private: true,
    license: 'MIT',
    engines: { node: '>=22 <25' },
    repository: { type: 'git', url: repositoryUrl },
    homepage: homepageUrl,
    bugs: { url: `${repositoryUrl.replace(/\.git$/, '')}/issues` },
  }))
  await add('package-lock.json', JSON.stringify({
    name: slug,
    version: '0.5.0-preview.1',
    packages: {
      '': {
        name: slug,
        version: '0.5.0-preview.1',
      },
    },
  }))
  await add('README.md', `# ${brand}\n\nVersion 0.5.0-preview.1\n\n${repositoryUrl.replace(/\.git$/, '')}\n`)
  await add('CHANGELOG.md', '## [0.5.0-preview.1] - Unreleased\n')
  await add('docs/decisions/2026-07-17-public-brand-selection.md', [
    '# Brand',
    '',
    'Status: Accepted',
    `Display name: ${brand}`,
    `Slug: ${slug}`,
    `Repository: ${repositoryUrl}`,
    `Pages project: ${slug}`,
    `Homepage: ${homepageUrl}`,
    '',
  ].join('\n'))
  await add('test/fixtures/character-pack/local-image-golden/manifest.json', JSON.stringify({
    schema_version: 1,
    samples: [],
  }))
  const allowedSyntheticPath = ['/Users', 'private', 'input.png'].join('/')
  await add('test/editor-project/synthetic.test.js', `export const path = '${allowedSyntheticPath}'\n`)
  await add('.env.example', `OPENROUTER_APP_NAME=${brand}\n`)
  await add('AGENTS.md', `${brand} contributor rules\n`)
  await add('ATTRIBUTIONS.md', `${brand} attributions\n`)
  await add('LICENSE', `${brand} contributors\n`)
  await add('index.html', `<title>${brand}</title>\n`)
  await add('src/character-pack/providers/openRouterAdapter.js', `export const appName = '${brand}'\n`)
  await add('src/character-pack/providers/providerConfig.js', `export const appName = '${brand}'\n`)
  await add('website/README.md', `# ${brand} website\n`)
  await add('website/index.html', `<title>${brand}</title>\n${homepageUrl}\n0.5.0-preview.1\n`)
  await add('scripts/example.js', 'export const value = 1\n')
  await add('.claude/launch.json', '{}\n')

  return { root, files }
}

test('public release checker passes an approved source-only fixture', async () => {
  const fixture = await releaseFixture()
  const report = await checkPublicRelease({
    rootDir: fixture.root,
    trackedFiles: fixture.files,
  })
  assert.equal(report.status, 'pass', JSON.stringify(report.issues))
  assert.deepEqual(report.issues, [])
})

test('public snapshot export copies only included regular files and writes a ledger', async () => {
  const fixture = await releaseFixture()
  const destination = path.join(os.tmpdir(), `public-release-export-${randomUUID()}`)
  const result = await exportPublicSnapshot({
    rootDir: fixture.root,
    destination,
    trackedFiles: fixture.files,
    skipReleaseCheck: true,
    sourceCommit: 'a'.repeat(40),
  })

  assert.equal(result.source_commit, 'a'.repeat(40))
  await access(path.join(destination, 'scripts/example.js'))
  await assert.rejects(access(path.join(destination, '.claude/launch.json')))
  const ledger = JSON.parse(await readFile(path.join(destination, 'PUBLIC_SNAPSHOT.json'), 'utf8'))
  assert.equal(ledger.release_version, '0.5.0-preview.1')
  assert.equal(ledger.files.some((item) => item.path === 'scripts/example.js'), true)
  assert.equal(ledger.files.some((item) => item.path === '.claude/launch.json'), false)
})

test('exported snapshot passes without Git and detects file tampering', async () => {
  const fixture = await releaseFixture()
  const destination = path.join(os.tmpdir(), `public-release-snapshot-${randomUUID()}`)
  await exportPublicSnapshot({
    rootDir: fixture.root,
    destination,
    trackedFiles: fixture.files,
    skipReleaseCheck: true,
    sourceCommit: 'b'.repeat(40),
  })

  const clean = await checkPublicRelease({ rootDir: destination })
  assert.equal(clean.status, 'pass', JSON.stringify(clean.issues))

  await writeFile(path.join(destination, 'scripts/example.js'), 'tampered\n')
  const tampered = await checkPublicRelease({ rootDir: destination })
  assert.equal(tampered.status, 'fail')
  assert.equal(tampered.issues.some((item) => item.code === 'snapshot.ledger_sha256'), true)
})

test('public snapshot export rejects an existing non-empty destination without deleting it', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'public-release-source-'))
  const destination = await mkdtemp(path.join(os.tmpdir(), 'public-release-nonempty-'))
  const sentinel = path.join(destination, 'keep.txt')
  await writeFile(sentinel, 'keep')

  await assert.rejects(
    validateExportDestination({ rootDir: root, destination }),
    /must be empty/
  )
  assert.equal(await readFile(sentinel, 'utf8'), 'keep')
})

test('public snapshot export rejects worktree nesting and symlink-parent escape', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'public-release-root-'))
  const worktree = await mkdtemp(path.join(os.tmpdir(), 'public-release-worktree-'))
  await assert.rejects(
    validateExportDestination({
      rootDir: root,
      destination: path.join(worktree, 'nested-export'),
      worktreePaths: [worktree],
    }),
    /worktree/
  )

  const symlinkParent = path.join(os.tmpdir(), `public-release-link-${randomUUID()}`)
  await symlink(worktree, symlinkParent)
  await assert.rejects(
    validateExportDestination({
      rootDir: root,
      destination: path.join(symlinkParent, 'linked-export'),
      worktreePaths: [worktree],
    }),
    /parent|worktree/
  )
})

test('release checker rejects configured Provider credentials without exposing values', async () => {
  const fixture = await releaseFixture()
  const previous = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = 'secret-value-that-must-not-be-reported'
  try {
    const report = await checkPublicRelease({
      rootDir: fixture.root,
      trackedFiles: fixture.files,
    })
    const providerIssue = report.issues.find((item) => item.code === 'provider.environment_configured')
    assert.equal(providerIssue.environment, 'OPENROUTER_API_KEY')
    assert.equal(JSON.stringify(report).includes('secret-value-that-must-not-be-reported'), false)
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY
    else process.env.OPENROUTER_API_KEY = previous
  }
})

test('release checker limits synthetic home paths to configured file/user pairs', async () => {
  const fixture = await releaseFixture()
  const allowed = await checkPublicRelease({
    rootDir: fixture.root,
    trackedFiles: fixture.files,
  })
  assert.equal(allowed.issues.some((item) => item.code === 'privacy.real_home_path'), false)

  await writeFile(
    path.join(fixture.root, 'test/editor-project/synthetic.test.js'),
    `export const path = '${['/Users', 'actual-owner', 'input.png'].join('/')}'\n`
  )
  const rejected = await checkPublicRelease({
    rootDir: fixture.root,
    trackedFiles: fixture.files,
  })
  assert.equal(rejected.issues.some((item) => item.code === 'privacy.real_home_path'), true)
})
