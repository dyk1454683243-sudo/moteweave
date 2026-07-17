const palette = Object.freeze({
  background: '#090d0a',
  grid: 'rgba(178, 220, 190, 0.10)',
  gridStrong: 'rgba(155, 248, 193, 0.24)',
  mint: '#9bf8c1',
  amber: '#ffc875',
  paper: '#edf7ef',
  outline: '#17221a',
  skin: '#f1bb8f',
  hair: '#c8e7da',
  tunic: '#4bb981',
  tunicDark: '#267253',
  belt: '#6f4b33',
  boot: '#302a27',
  blade: '#dbe9e2',
  bladeShade: '#81998d',
})

const motions = Object.freeze({
  idle: [
    { y: 0, leftLeg: 0, rightLeg: 0, arm: 0, blade: 0 },
    { y: 0, leftLeg: 0, rightLeg: 0, arm: 1, blade: 0 },
    { y: -1, leftLeg: 0, rightLeg: 0, arm: 1, blade: 0 },
    { y: 0, leftLeg: 0, rightLeg: 0, arm: 0, blade: 0 },
  ],
  walk: [
    { y: 0, leftLeg: -2, rightLeg: 2, arm: 2, blade: -1 },
    { y: -1, leftLeg: -1, rightLeg: 1, arm: 1, blade: 0 },
    { y: -2, leftLeg: 0, rightLeg: 0, arm: 0, blade: 1 },
    { y: -1, leftLeg: 1, rightLeg: -1, arm: -1, blade: 1 },
    { y: 0, leftLeg: 2, rightLeg: -2, arm: -2, blade: 0 },
    { y: -1, leftLeg: 1, rightLeg: -1, arm: -1, blade: -1 },
    { y: -2, leftLeg: 0, rightLeg: 0, arm: 0, blade: -1 },
    { y: 0, leftLeg: -2, rightLeg: 2, arm: 2, blade: -1 },
  ],
  attack: [
    { y: 0, leftLeg: -1, rightLeg: 1, arm: -2, blade: -4 },
    { y: -1, leftLeg: -1, rightLeg: 1, arm: -4, blade: -7 },
    { y: -1, leftLeg: 0, rightLeg: 1, arm: 1, blade: -1 },
    { y: 0, leftLeg: 1, rightLeg: -1, arm: 5, blade: 6 },
    { y: 0, leftLeg: 1, rightLeg: -1, arm: 3, blade: 4 },
    { y: 0, leftLeg: 0, rightLeg: 0, arm: 0, blade: 0 },
  ],
})

const modeNames = Object.freeze({
  source: '原始帧',
  grid: '网格整理',
  motion: '动作预览',
  evidence: '检查证据',
})

const state = {
  action: 'walk',
  mode: 'grid',
  fps: 8,
  showGrid: true,
  frameIndex: 0,
  lastFrameAt: 0,
  animationFrame: 0,
  paused: false,
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
const heroCanvas = document.querySelector('#hero-canvas')
const demoCanvas = document.querySelector('#demo-canvas')
const frameTrack = document.querySelector('#demo-frame-track')
const frameLabel = document.querySelector('#demo-frame-label')
const demoStatus = document.querySelector('#demo-status')
const stageTitle = document.querySelector('#demo-stage-title')

function configureCanvas(canvas) {
  if (!canvas) return null
  const bounds = canvas.getBoundingClientRect()
  const cssWidth = Math.max(1, Math.round(bounds.width || Number(canvas.getAttribute('width'))))
  const cssHeight = Math.max(1, Math.round(bounds.height || Number(canvas.getAttribute('height'))))
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const targetWidth = Math.round(cssWidth * dpr)
  const targetHeight = Math.round(cssHeight * dpr)
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth
    canvas.height = targetHeight
  }
  const context = canvas.getContext('2d')
  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.imageSmoothingEnabled = false
  return { context, width: cssWidth, height: cssHeight }
}

function fillRect(context, color, x, y, width, height) {
  context.fillStyle = color
  context.fillRect(Math.round(x), Math.round(y), Math.round(width), Math.round(height))
}

function drawGrid(context, width, height, cell = 16, strong = false) {
  context.save()
  context.strokeStyle = strong ? palette.gridStrong : palette.grid
  context.lineWidth = 1
  context.beginPath()
  for (let x = 0.5; x < width; x += cell) {
    context.moveTo(x, 0)
    context.lineTo(x, height)
  }
  for (let y = 0.5; y < height; y += cell) {
    context.moveTo(0, y)
    context.lineTo(width, y)
  }
  context.stroke()
  context.restore()
}

function drawBackdrop(context, width, height, mode, showGrid) {
  fillRect(context, palette.background, 0, 0, width, height)

  const glow = context.createRadialGradient(
    width * 0.52,
    height * 0.48,
    8,
    width * 0.52,
    height * 0.48,
    Math.max(width, height) * 0.48,
  )
  glow.addColorStop(0, mode === 'source' ? 'rgba(255, 200, 117, 0.08)' : 'rgba(84, 229, 154, 0.09)')
  glow.addColorStop(1, 'rgba(8, 11, 9, 0)')
  context.fillStyle = glow
  context.fillRect(0, 0, width, height)

  if (showGrid || mode === 'grid' || mode === 'evidence') {
    drawGrid(context, width, height, Math.max(12, Math.round(width / 24)), mode === 'grid')
  }
}

function drawShadow(context, centerX, baseY, scale, alpha = 0.35) {
  context.save()
  context.globalAlpha = alpha
  fillRect(context, '#000000', centerX - 7 * scale, baseY, 14 * scale, 2 * scale)
  fillRect(context, '#000000', centerX - 5 * scale, baseY - scale, 10 * scale, 4 * scale)
  context.restore()
}

function drawSprite(context, centerX, baseY, scale, frame, options = {}) {
  const x = Math.round(centerX - 8 * scale)
  const y = Math.round(baseY - 23 * scale + frame.y * scale)
  const alpha = options.alpha ?? 1

  context.save()
  context.globalAlpha = alpha

  if (!options.noShadow) drawShadow(context, centerX, baseY + 2 * scale, scale, 0.3 * alpha)

  fillRect(context, palette.outline, x + (3 + frame.leftLeg) * scale, y + 17 * scale, 4 * scale, 6 * scale)
  fillRect(context, palette.outline, x + (9 + frame.rightLeg) * scale, y + 17 * scale, 4 * scale, 6 * scale)
  fillRect(context, palette.boot, x + (3 + frame.leftLeg) * scale, y + 19 * scale, 4 * scale, 4 * scale)
  fillRect(context, palette.boot, x + (9 + frame.rightLeg) * scale, y + 19 * scale, 4 * scale, 4 * scale)

  fillRect(context, palette.outline, x + 3 * scale, y + 8 * scale, 10 * scale, 12 * scale)
  fillRect(context, palette.tunicDark, x + 4 * scale, y + 9 * scale, 8 * scale, 10 * scale)
  fillRect(context, palette.tunic, x + 5 * scale, y + 9 * scale, 6 * scale, 8 * scale)
  fillRect(context, palette.belt, x + 4 * scale, y + 15 * scale, 8 * scale, 2 * scale)
  fillRect(context, palette.amber, x + 7 * scale, y + 15 * scale, 2 * scale, 2 * scale)

  const rearArmY = y + (10 - Math.max(0, frame.arm)) * scale
  fillRect(context, palette.outline, x + 1 * scale, rearArmY, 4 * scale, 8 * scale)
  fillRect(context, palette.tunicDark, x + 2 * scale, rearArmY + scale, 2 * scale, 5 * scale)
  fillRect(context, palette.skin, x + 2 * scale, rearArmY + 6 * scale, 2 * scale, 2 * scale)

  const frontArmX = x + (12 + Math.max(0, frame.arm)) * scale
  const frontArmY = y + (10 - Math.min(0, frame.arm)) * scale
  fillRect(context, palette.outline, frontArmX, frontArmY, 4 * scale, 8 * scale)
  fillRect(context, palette.tunic, frontArmX + scale, frontArmY + scale, 2 * scale, 5 * scale)
  fillRect(context, palette.skin, frontArmX + scale, frontArmY + 6 * scale, 2 * scale, 2 * scale)

  fillRect(context, palette.outline, x + 4 * scale, y + 1 * scale, 8 * scale, 9 * scale)
  fillRect(context, palette.skin, x + 5 * scale, y + 3 * scale, 6 * scale, 6 * scale)
  fillRect(context, palette.hair, x + 4 * scale, y + 1 * scale, 8 * scale, 4 * scale)
  fillRect(context, palette.hair, x + 4 * scale, y + 3 * scale, 2 * scale, 6 * scale)
  fillRect(context, palette.outline, x + 9 * scale, y + 5 * scale, scale, scale)
  fillRect(context, palette.mint, x + 9 * scale, y + 5 * scale, scale, scale)

  const bladeX = x + (15 + frame.arm + frame.blade) * scale
  const bladeY = y + (7 - frame.arm - Math.floor(frame.blade / 2)) * scale
  fillRect(context, palette.outline, bladeX, bladeY, 3 * scale, 12 * scale)
  fillRect(context, palette.bladeShade, bladeX + scale, bladeY, scale, 11 * scale)
  fillRect(context, palette.blade, bladeX + scale, bladeY, scale, 8 * scale)
  fillRect(context, palette.amber, bladeX - scale, bladeY + 9 * scale, 5 * scale, 2 * scale)

  if (options.annotate) {
    context.strokeStyle = palette.mint
    context.lineWidth = 1
    context.strokeRect(x - 2 * scale + 0.5, y - scale + 0.5, 22 * scale, 26 * scale)
  }

  context.restore()
}

function drawSourceNoise(context, width, height) {
  context.save()
  context.globalAlpha = 0.18
  for (let index = 0; index < 22; index += 1) {
    const x = ((index * 47) % Math.max(1, width - 20)) + 10
    const y = ((index * 73) % Math.max(1, height - 20)) + 10
    fillRect(context, index % 2 ? palette.amber : palette.paper, x, y, 2, 2)
  }
  context.restore()
}

function drawModeOverlay(context, width, height, mode, frame, action) {
  context.save()
  context.font = '700 10px ui-monospace, SFMono-Regular, Consolas, monospace'
  context.textBaseline = 'top'

  if (mode === 'source') {
    drawSourceNoise(context, width, height)
    context.fillStyle = palette.amber
    context.fillText('SOURCE SAMPLE / UNPROCESSED VIEW', 18, 18)
  }

  if (mode === 'grid') {
    context.fillStyle = palette.mint
    context.fillText('GRID PHASE LOCK / DEMO', 18, 18)
    context.fillStyle = 'rgba(155, 248, 193, 0.72)'
    context.fillText('SHARED PALETTE', 18, 34)
  }

  if (mode === 'motion') {
    const frames = motions[action]
    const prior = frames[(frame - 2 + frames.length) % frames.length]
    const next = frames[(frame + 2) % frames.length]
    drawSprite(context, width * 0.31, height * 0.69, Math.max(3, Math.floor(width / 150)), prior, {
      alpha: 0.16,
      noShadow: true,
    })
    drawSprite(context, width * 0.69, height * 0.69, Math.max(3, Math.floor(width / 150)), next, {
      alpha: 0.16,
      noShadow: true,
    })
    context.fillStyle = palette.mint
    context.fillText('SEQUENCE PREVIEW / ONION CONTEXT', 18, 18)
  }

  if (mode === 'evidence') {
    context.fillStyle = palette.mint
    context.fillText('BUILT-IN SAMPLE EVIDENCE', 18, 18)
    const cardWidth = Math.min(150, width * 0.28)
    const cardX = width - cardWidth - 18
    const labels = ['FRAME COUNT', 'UNIQUE POSES', 'LOOP GAP']
    labels.forEach((label, index) => {
      const y = 18 + index * 40
      context.fillStyle = 'rgba(16, 20, 17, 0.88)'
      context.fillRect(cardX, y, cardWidth, 31)
      context.strokeStyle = 'rgba(155, 248, 193, 0.2)'
      context.strokeRect(cardX + 0.5, y + 0.5, cardWidth - 1, 30)
      context.fillStyle = 'rgba(237, 247, 239, 0.62)'
      context.fillText(label, cardX + 8, y + 8)
    })
  }

  context.restore()
}

function drawCanvas(canvas, { mode, action, frameIndex, showGrid, hero = false }) {
  const configured = configureCanvas(canvas)
  if (!configured) return
  const { context, width, height } = configured
  drawBackdrop(context, width, height, mode, showGrid)

  const frames = motions[action]
  const frame = frames[frameIndex % frames.length]
  const scale = Math.max(3, Math.floor(Math.min(width, height) / (hero ? 48 : 46)))
  const centerX = hero ? width * 0.5 : width * 0.48
  const baseY = hero ? height * 0.76 : height * 0.73

  drawModeOverlay(context, width, height, mode, frameIndex % frames.length, action)
  drawSprite(context, centerX, baseY, scale, frame, {
    annotate: mode === 'evidence',
  })

  if (mode === 'grid') {
    context.save()
    context.strokeStyle = 'rgba(155, 248, 193, 0.45)'
    context.lineWidth = 1
    const boxSize = 32 * scale
    context.strokeRect(
      Math.round(centerX - boxSize / 2) + 0.5,
      Math.round(baseY - boxSize * 0.78) + 0.5,
      boxSize,
      boxSize,
    )
    context.restore()
  }
}

function poseSignature(frame) {
  return [frame.y, frame.leftLeg, frame.rightLeg, frame.arm, frame.blade].join(':')
}

function poseDistance(first, last) {
  return (
    Math.abs(first.y - last.y) +
    Math.abs(first.leftLeg - last.leftLeg) +
    Math.abs(first.rightLeg - last.rightLeg) +
    Math.abs(first.arm - last.arm) +
    Math.abs(first.blade - last.blade)
  )
}

function updateEvidence() {
  const frames = motions[state.action]
  const uniquePoses = new Set(frames.map(poseSignature)).size
  const loopGap = poseDistance(frames[0], frames[frames.length - 1])
  document.querySelector('#metric-frame-count').textContent = String(frames.length)
  document.querySelector('#metric-unique-poses').textContent = String(uniquePoses)
  document.querySelector('#metric-loop-gap').textContent = `${loopGap} px`
  document.querySelector('#metric-palette-count').textContent = String(
    new Set([
      palette.outline,
      palette.skin,
      palette.hair,
      palette.tunic,
      palette.tunicDark,
      palette.belt,
      palette.boot,
      palette.blade,
    ]).size,
  )
}

function renderFrameTrack() {
  if (!frameTrack) return
  const frames = motions[state.action]
  frameTrack.replaceChildren(
    ...frames.map((_, index) => {
      const chip = document.createElement('span')
      chip.className = `frame-chip${index === state.frameIndex % frames.length ? ' is-active' : ''}`
      chip.setAttribute('aria-hidden', 'true')
      return chip
    }),
  )
  if (frameLabel) {
    const current = String((state.frameIndex % frames.length) + 1).padStart(2, '0')
    const total = String(frames.length).padStart(2, '0')
    frameLabel.textContent = `FRAME ${current} / ${total}`
  }
}

function updateDemoText() {
  if (stageTitle) stageTitle.textContent = modeNames[state.mode]
  if (demoStatus) {
    const actionName = state.action.charAt(0).toUpperCase() + state.action.slice(1)
    demoStatus.textContent = `正在展示 ${actionName} 动作的${modeNames[state.mode]}阶段。`
  }
}

function drawAll() {
  drawCanvas(heroCanvas, {
    mode: 'motion',
    action: 'walk',
    frameIndex: state.frameIndex,
    showGrid: true,
    hero: true,
  })
  drawCanvas(demoCanvas, {
    mode: state.mode,
    action: state.action,
    frameIndex: state.frameIndex,
    showGrid: state.showGrid,
  })
  renderFrameTrack()
}

function animate(timestamp) {
  if (!state.paused && !reducedMotion.matches) {
    const interval = 1000 / state.fps
    if (timestamp - state.lastFrameAt >= interval) {
      state.frameIndex = (state.frameIndex + 1) % motions[state.action].length
      state.lastFrameAt = timestamp
      drawAll()
    }
  }
  state.animationFrame = window.requestAnimationFrame(animate)
}

function setMode(mode) {
  if (!Object.hasOwn(modeNames, mode)) return
  state.mode = mode
  document.querySelectorAll('[data-demo-mode]').forEach((button) => {
    const active = button.dataset.demoMode === mode
    button.classList.toggle('is-active', active)
    button.setAttribute('aria-selected', String(active))
  })
  updateDemoText()
  drawAll()
}

function setAction(action) {
  if (!Object.hasOwn(motions, action)) return
  state.action = action
  state.frameIndex = 0
  document.querySelectorAll('[data-demo-action]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.demoAction === action)
  })
  updateEvidence()
  updateDemoText()
  drawAll()
}

document.querySelectorAll('[data-demo-mode]').forEach((button) => {
  button.addEventListener('click', () => setMode(button.dataset.demoMode))
})

document.querySelectorAll('[data-demo-action]').forEach((button) => {
  button.addEventListener('click', () => setAction(button.dataset.demoAction))
})

const speedInput = document.querySelector('#demo-speed')
const speedOutput = document.querySelector('#demo-speed-output')
speedInput?.addEventListener('input', () => {
  state.fps = Number(speedInput.value)
  if (speedOutput) speedOutput.textContent = `${state.fps} FPS`
})

const gridInput = document.querySelector('#demo-grid')
gridInput?.addEventListener('change', () => {
  state.showGrid = gridInput.checked
  drawAll()
})

document.addEventListener('visibilitychange', () => {
  state.paused = document.hidden
  if (!state.paused) {
    state.lastFrameAt = performance.now()
    drawAll()
  }
})

reducedMotion.addEventListener?.('change', () => {
  state.frameIndex = 0
  drawAll()
})

const menuToggle = document.querySelector('[data-menu-toggle]')
const siteNav = document.querySelector('[data-site-nav]')
menuToggle?.addEventListener('click', () => {
  const isOpen = menuToggle.getAttribute('aria-expanded') === 'true'
  menuToggle.setAttribute('aria-expanded', String(!isOpen))
  siteNav?.classList.toggle('is-open', !isOpen)
})

siteNav?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    siteNav.classList.remove('is-open')
    menuToggle?.setAttribute('aria-expanded', 'false')
  })
})

const header = document.querySelector('[data-site-header]')
function updateHeader() {
  header?.classList.toggle('is-scrolled', window.scrollY > 18)
}
window.addEventListener('scroll', updateHeader, { passive: true })
updateHeader()

const copyButton = document.querySelector('#copy-command')
const copyStatus = document.querySelector('#copy-status')
copyButton?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText('npm install\nnpm start')
    if (copyStatus) copyStatus.textContent = '已复制本地启动命令'
    copyButton.textContent = '已复制'
  } catch {
    if (copyStatus) copyStatus.textContent = '浏览器未允许复制，请手动选择命令'
  }
  window.setTimeout(() => {
    copyButton.textContent = '复制命令'
  }, 1800)
})

const revealTargets = document.querySelectorAll('[data-reveal]')
if (reducedMotion.matches || !('IntersectionObserver' in window)) {
  revealTargets.forEach((target) => target.classList.add('is-visible'))
} else {
  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      })
    },
    { threshold: 0.12 },
  )
  revealTargets.forEach((target) => revealObserver.observe(target))
}

const resizeObserver =
  'ResizeObserver' in window
    ? new ResizeObserver(() => {
        drawAll()
      })
    : null

if (heroCanvas) resizeObserver?.observe(heroCanvas)
if (demoCanvas) resizeObserver?.observe(demoCanvas)

document.querySelector('#current-year').textContent = String(new Date().getFullYear())

updateEvidence()
updateDemoText()
drawAll()
state.animationFrame = window.requestAnimationFrame(animate)
