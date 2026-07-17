import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const outDir = 'test/fixtures/character-pack'
const cell = 192
const cols = 8
const rows = 8
const sheetW = cols * cell
const sheetH = rows * cell

await mkdir(outDir, { recursive: true })

const composites = []
for (let row = 0; row < rows; row++) {
  for (let col = 0; col < cols; col++) {
    const cx = 96
    const footY = 154
    const bob = row <= 3 ? [0, -2, 0, -1][col % 4] : 0
    const bodyH = row >= 6 ? 62 : 84
    const bodyW = row >= 4 && row <= 5 ? 42 : 34
    const cloak = row % 2 === 0 ? '#203048' : '#29354e'
    const hair = '#d8dde8'
    const accent = '#8b3940'
    const x = cx - Math.floor(bodyW / 2)
    const y = footY - bodyH + bob
    const svg = `
      <svg width="${cell}" height="${cell}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">
        <rect x="${cx - 14}" y="${footY - 8}" width="10" height="8" fill="#141414"/>
        <rect x="${cx + 4}" y="${footY - 8}" width="10" height="8" fill="#141414"/>
        <rect x="${x}" y="${y + 30}" width="${bodyW}" height="${bodyH - 30}" fill="#111827"/>
        <rect x="${x + 4}" y="${y + 34}" width="${bodyW - 8}" height="${bodyH - 42}" fill="${cloak}"/>
        <rect x="${cx - 19}" y="${y + 12}" width="38" height="30" fill="${hair}"/>
        <rect x="${cx - 16}" y="${y + 18}" width="32" height="28" fill="#f0c4a8"/>
        <rect x="${cx - 9}" y="${y + 28}" width="5" height="5" fill="#111827"/>
        <rect x="${cx + 4}" y="${y + 28}" width="5" height="5" fill="#111827"/>
        <rect x="${cx - 21}" y="${y + 44}" width="8" height="24" fill="${accent}"/>
        <rect x="${cx + 13}" y="${y + 44}" width="8" height="24" fill="${accent}"/>
        <rect x="${cx - 24 + (col % 4) * 3}" y="${y + 64}" width="8" height="24" fill="#0f172a"/>
        <rect x="${cx + 16 - (col % 4) * 3}" y="${y + 64}" width="8" height="24" fill="#0f172a"/>
      </svg>`
    composites.push({ input: Buffer.from(svg), left: col * cell, top: row * cell })
  }
}

await sharp({
  create: {
    width: sheetW,
    height: sheetH,
    channels: 4,
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  },
})
  .composite(composites)
  .png()
  .toFile(`${outDir}/topdown_rpg_v0_sample_hero.png`)

await writeFile(
  `${outDir}/topdown_rpg_v0_sample_hero.expected.json`,
  JSON.stringify(
    {
      profile: 'topdown_rpg_v0',
      grid: { columns: 8, rows: 8, source_cell_size: { w: 192, h: 192 } },
      expected_frame_count: 64,
      expected_status: 'pass',
      expected_anchor: { x: 48, y: 88 },
      expected_animations: [
        'idle_down',
        'idle_up',
        'idle_left',
        'idle_right',
        'walk_down',
        'walk_up',
        'walk_left',
        'walk_right',
        'attack_down',
        'attack_up',
        'attack_left',
        'attack_right',
        'hurt',
        'happy',
        'sit',
        'talk',
      ],
    },
    null,
    2
  )
)
