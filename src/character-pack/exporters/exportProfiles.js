export const RPGMAKER_V0 = Object.freeze({
  id: 'rpgmaker_v0',
  folderRoot: 'AI资源库/RPGMAKER',
  spriteFileName: 'sprite.png',
  jsonFileName: 'NPC.json',
  frame: { w: 48, h: 48 },
  sheet: { w: 144, h: 192 },
  grid: { columns: 3, rows: 4 },
  rows: [
    { name: 'rundown', source: 'walk_down', row: 0 },
    { name: 'runleft', source: 'walk_left', row: 1 },
    { name: 'runright', source: 'walk_right', row: 2 },
    { name: 'runup', source: 'walk_up', row: 3 },
  ],
  sourceColumns: [0, 1, 2],
})

export const OCAD_V0 = Object.freeze({
  id: 'ocad_v0',
  folderRoot: 'AI资源库/一图全动作',
  spriteFileName: 'sprite.png',
  jsonFileName: 'npc.json',
  sheet: { w: 252, h: 252 },
})
