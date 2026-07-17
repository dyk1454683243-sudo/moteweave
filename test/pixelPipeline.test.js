import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildCharacterPrompt,
  buildScenePrompt,
  buildSpriteIndex,
  normalizeExportParams,
} from '../src/pixelPipeline.js'

test('buildScenePrompt locks a topdown-front scene and forbids non-background elements', () => {
  const prompt = buildScenePrompt({
    view: 'topdown-front',
    theme: '雨夜温泉旅馆，木制走廊，暖色灯笼，石板路',
    composition: '主建筑居中，入口和可通行路径清晰，边缘有竹林与水汽',
    style: '清晰像素块，低饱和暖光，统一调色',
  })

  assert.match(prompt, /topdown 正视/)
  assert.match(prompt, /建筑全部正朝向/)
  assert.match(prompt, /不要人物、UI、文字、水印/)
  assert.match(prompt, /只输出完整场景图/)
  assert.match(prompt, /雨夜温泉旅馆/)
})

test('buildScenePrompt adds parallax layer rules for arcade scenes', () => {
  const prompt = buildScenePrompt({
    view: 'arcade-side',
    theme: '赛博港口仓库，红色警报灯，潮湿地面',
    composition: '远处货轮，中景平台，前景管线和栏杆',
    style: '高饱和霓虹，强对比环境光',
  })

  assert.match(prompt, /横版街机/)
  assert.match(prompt, /远景/)
  assert.match(prompt, /中景/)
  assert.match(prompt, /前景/)
  assert.match(prompt, /视差层/)
})

test('buildCharacterPrompt preserves the template sprite sheet contract', () => {
  const prompt = buildCharacterPrompt({
    preset: 'topdown-8dir',
    character: '银发女剑士，深蓝披风，细长单手剑，金色护肩，小体型',
    hasReferenceImage: true,
  })

  assert.match(prompt, /模板 Sprite Sheet/)
  assert.match(prompt, /角色参考图放在模板图之后/)
  assert.match(prompt, /动作顺序、朝向、姿势、比例/)
  assert.match(prompt, /单元格间距、画布尺寸和 Sprite Sheet 布局/)
  assert.match(prompt, /不要文字、编号、UI、网格线、边框、水印/)
  assert.match(prompt, /八方向 TopDown/)
  assert.match(prompt, /银发女剑士/)
})

test('normalizeExportParams clamps unsafe sprite export values', () => {
  assert.deepEqual(
    normalizeExportParams({
      targetW: -5,
      targetH: 0,
      padding: -2,
      spacing: 999,
      columns: 0,
      fps: 0,
    }),
    {
      targetW: 1,
      targetH: 1,
      padding: 0,
      spacing: 128,
      columns: 1,
      fps: 1,
    }
  )
})

test('buildSpriteIndex records uniform cell coordinates and rounded timestamps', () => {
  const index = buildSpriteIndex({
    frameCount: 5,
    targetW: 64,
    targetH: 96,
    spacing: 2,
    columns: 3,
    fps: 12,
  })

  assert.deepEqual(index.frame_size, { w: 64, h: 96 })
  assert.deepEqual(index.sheet_size, { w: 196, h: 194 })
  assert.equal(index.frames.length, 5)
  assert.deepEqual(index.frames[0], { i: 0, x: 0, y: 0, w: 64, h: 96, t: 0 })
  assert.deepEqual(index.frames[3], { i: 3, x: 0, y: 98, w: 64, h: 96, t: 0.25 })
})
