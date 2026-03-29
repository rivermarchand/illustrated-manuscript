import { prepareWithSegments, layoutNextLine, type LayoutCursor, type PreparedTextWithSegments } from '@chenglou/pretext'
import { loadDragonSprites, makeDragon, updateCreatureScale, stepCreature, getCreatureIntervalsForBand, getFireIntervalsForBand, drawCreature, spawnFireParticles, stepFire, drawFire, hasActiveFire, getFireForce, type Creature } from './creature'
import { STORY_TEXT } from './text'

// --- Responsive config ---
const BASE_PAGE_WIDTH = 700
const BASE_MARGIN = 45
const BASE_FONT_SIZE = 21
const BASE_LINE_HEIGHT = 34
const FONT_FAMILY = '"Furia", "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, "Georgia", serif'
const TEXT_COLOR = '#2a1a0a'
const BG_COLOR = '#f4eee0'

type PageDims = {
  pageWidth: number
  pageHeight: number
  margin: number
  fontSize: number
  lineHeight: number
  font: string
}

function computeDims(): PageDims {
  const pageWidth = Math.min(BASE_PAGE_WIDTH, window.innerWidth - 40)
  const ratio = pageWidth / BASE_PAGE_WIDTH
  const pageHeight = Math.min(960, window.innerHeight - 60)
  const margin = Math.round(BASE_MARGIN * ratio)
  const textRatio = 0.4 + 0.6 * ratio
  const fontSize = Math.max(14, Math.round(BASE_FONT_SIZE * textRatio))
  const lineHeight = Math.max(22, Math.round(BASE_LINE_HEIGHT * textRatio))
  const font = `${fontSize}px ${FONT_FAMILY}`
  return { pageWidth, pageHeight, margin, fontSize, lineHeight, font }
}

let dims = computeDims()

// --- Canvas: fills viewport ---
const canvas = document.getElementById('manuscript') as HTMLCanvasElement
const ctx = canvas.getContext('2d', { alpha: false })!

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(window.innerWidth * dpr)
  canvas.height = Math.round(window.innerHeight * dpr)
  canvas.style.width = `${window.innerWidth}px`
  canvas.style.height = `${window.innerHeight}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}
resizeCanvas()
window.addEventListener('resize', () => {
  dims = computeDims()
  ensureTextPrepared()
  updateCreatureScale(dragon, getCreatureScale())
  resizeCanvas()
  layoutDirty = true
  scheduleRender()
})

// Page offset — centered in viewport
function pageOffset(): { x: number; y: number } {
  return {
    x: Math.round((window.innerWidth - dims.pageWidth) / 2),
    y: Math.round(Math.max(20, (window.innerHeight - dims.pageHeight) / 2)),
  }
}

// --- State ---
const mouse = { x: 0, y: 0 }
let lastMouseMoveTime = 0
const IDLE_THRESHOLD = 2000

canvas.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX
  mouse.y = e.clientY
  lastMouseMoveTime = performance.now()
  scheduleRender()
})

let mouseDown = false

canvas.addEventListener('mousedown', () => {
  mouseDown = true
  scheduleRender()
})

canvas.addEventListener('mouseup', () => {
  mouseDown = false
})

canvas.addEventListener('mouseleave', () => {
  mouseDown = false
})

// Touch events for mobile
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault()
  const touch = e.touches[0]!
  mouse.x = touch.clientX
  mouse.y = touch.clientY
  mouseDown = true
  lastMouseMoveTime = performance.now()
  scheduleRender()
}, { passive: false })

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault()
  const touch = e.touches[0]!
  mouse.x = touch.clientX
  mouse.y = touch.clientY
  lastMouseMoveTime = performance.now()
  scheduleRender()
}, { passive: false })

canvas.addEventListener('touchend', () => {
  mouseDown = false
})

// --- Load dragon sprites, then create creature ---
await loadDragonSprites()

function getCreatureScale(): number {
  return Math.min(1, dims.pageWidth / BASE_PAGE_WIDTH)
}

const dragon: Creature = (() => {
  const p = pageOffset()
  return makeDragon(p.x + dims.pageWidth / 2, p.y + dims.pageHeight / 3, getCreatureScale())
})()

// --- Prepare text (re-prepared when font size changes) ---
await new FontFace('Furia', 'url(/furia-iii.ttf)').load().then(f => document.fonts.add(f))
await document.fonts.ready

const dropCapChar = STORY_TEXT[0]!
const restText = STORY_TEXT.slice(1)
let preparedBody = prepareWithSegments(restText, dims.font)
let lastPreparedFontSize = dims.fontSize

function ensureTextPrepared(): void {
  if (dims.fontSize !== lastPreparedFontSize) {
    preparedBody = prepareWithSegments(restText, dims.font)
    lastPreparedFontSize = dims.fontSize
  }
}

// --- Drop cap image ---
const dropCapImg = new Image()
dropCapImg.src = '/img/dropcap.png'
await new Promise<void>(resolve => { dropCapImg.onload = () => resolve() })

function getDropCapSize(): { width: number; height: number; drawWidth: number; drawHeight: number } {
  const drawHeight = dims.lineHeight * 7
  const drawWidth = dropCapImg.width * (drawHeight / dropCapImg.height)
  return { width: drawWidth + 12, height: drawHeight, drawWidth, drawHeight }
}

function drawDropCap(): void {
  const dc = getDropCapSize()
  ctx.drawImage(dropCapImg, dims.margin, dims.margin, dc.drawWidth, dc.drawHeight)
}

function dropCapMetrics(): { width: number; height: number } {
  return getDropCapSize()
}

// --- Text layout with obstacle avoidance (page-local coords) ---
type RectObstacle = { x: number; y: number; width: number; height: number }
type Slot = { left: number; right: number }

const MIN_SLOT_WIDTH = 40
const CREATURE_PADDING = 10

function carveSlots(slots: Slot[], blockLeft: number, blockRight: number): Slot[] {
  const next: Slot[] = []
  for (const slot of slots) {
    if (blockRight <= slot.left || blockLeft >= slot.right) {
      next.push(slot)
    } else {
      if (blockLeft > slot.left) next.push({ left: slot.left, right: blockLeft })
      if (blockRight < slot.right) next.push({ left: blockRight, right: slot.right })
    }
  }
  return next
}

function getLineSlots(
  lineY: number,
  lineHeight: number,
  rectObstacles: RectObstacle[],
  pageOffsetX: number,
  pageOffsetY: number,
): Slot[] {
  let slots: Slot[] = [{ left: dims.margin, right: dims.pageWidth - dims.margin }]

  for (const obs of rectObstacles) {
    if (lineY + lineHeight <= obs.y || lineY >= obs.y + obs.height) continue
    slots = carveSlots(slots, obs.x, obs.x + obs.width)
  }

  const worldBandTop = lineY + pageOffsetY
  const worldBandBottom = lineY + lineHeight + pageOffsetY
  const creatureIntervals = getCreatureIntervalsForBand(dragon, worldBandTop, worldBandBottom, CREATURE_PADDING)
  for (const interval of creatureIntervals) {
    slots = carveSlots(slots, interval.left - pageOffsetX, interval.right - pageOffsetX)
  }

  const fireIntervals = getFireIntervalsForBand(dragon, worldBandTop, worldBandBottom, 6)
  for (const interval of fireIntervals) {
    slots = carveSlots(slots, interval.left - pageOffsetX, interval.right - pageOffsetX)
  }

  return slots.filter(s => s.right - s.left >= MIN_SLOT_WIDTH)
}

function drawCharsWithFire(text: string, startX: number, y: number, pox: number, poy: number): void {
  const capHeight = dims.fontSize * 0.857
  const halfCap = capHeight / 2
  let x = startX
  for (const char of text) {
    const cw = ctx.measureText(char).width
    const worldX = x + cw / 2 + pox
    const worldY = y + halfCap + poy
    const force = getFireForce(dragon, worldX, worldY)

    if (force.strength < 0.01) {
      ctx.fillStyle = TEXT_COLOR
      ctx.globalAlpha = 1
      ctx.fillText(char, x, y)
    } else {
      const s = force.strength
      ctx.save()
      ctx.translate(x + cw / 2 + force.dx * s * 45, y + halfCap + force.dy * s * 45)
      ctx.rotate(s * (force.dx > 0 ? 1 : -1) * 1.2)
      ctx.globalAlpha = Math.max(0, 1 - s * 0.8)
      const r = Math.round(42 + s * 200)
      const g = Math.round(26 + s * 80)
      const b = Math.round(10)
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.fillText(char, -cw / 2, -halfCap)
      ctx.restore()
    }
    x += cw
  }
  ctx.globalAlpha = 1
  ctx.fillStyle = TEXT_COLOR
}

// --- Decorative vine border (page-local) ---
function drawVines(): void {
  ctx.save()
  ctx.strokeStyle = 'rgba(34, 85, 34, 0.25)'
  ctx.lineWidth = 2

  ctx.beginPath()
  const lx = dims.margin - 7
  for (let y = dims.margin - 5; y < dims.pageHeight - dims.margin + 5; y += 5) {
    const x = lx + Math.sin(y * 0.02) * 4
    if (y === dims.margin - 5) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  ctx.fillStyle = 'rgba(34, 85, 34, 0.15)'
  for (let y = dims.margin + 35; y < dims.pageHeight - dims.margin - 35; y += 60 + Math.sin(y) * 20) {
    const x = lx + Math.sin(y * 0.02) * 4
    ctx.beginPath()
    ctx.ellipse(x - 6, y, 8, 4, -0.5, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.strokeStyle = 'rgba(34, 85, 34, 0.25)'
  ctx.beginPath()
  const rx = dims.pageWidth - dims.margin + 7
  for (let y = dims.margin - 5; y < dims.pageHeight - dims.margin + 5; y += 5) {
    const x = rx + Math.sin(y * 0.025 + 1) * 4
    if (y === dims.margin - 5) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  ctx.restore()
}

// --- Shadow under page ---
function drawPageShadow(px: number, py: number): void {
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 30
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 8
  ctx.fillStyle = '#000'
  ctx.fillRect(px, py, dims.pageWidth, dims.pageHeight)
  ctx.restore()
}

// --- Cached text layout (only recomputed when creature moves) ---
type CachedLine = { text: string; x: number; y: number }
let cachedLines: CachedLine[] = []
let layoutDirty = true

function recomputeTextLayout(rectObstacles: RectObstacle[], pageOffsetX: number, pageOffsetY: number): void {
  cachedLines = []
  ctx.save()
  ctx.font = dims.font

  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  let y = dims.margin
  const capHeight = dims.fontSize * 0.857
  const textY = (dims.lineHeight - capHeight) / 2

  while (y + dims.lineHeight <= dims.pageHeight - dims.margin) {
    const slots = getLineSlots(y, dims.lineHeight, rectObstacles, pageOffsetX, pageOffsetY)
    if (slots.length === 0) { y += dims.lineHeight; continue }

    let exhausted = false
    for (const slot of slots) {
      const width = slot.right - slot.left
      const line = layoutNextLine(preparedBody, cursor, width)
      if (line === null) { exhausted = true; break }
      cachedLines.push({ text: line.text, x: slot.left, y: y + textY })
      cursor = line.end
    }
    if (exhausted) break
    y += dims.lineHeight
  }

  ctx.restore()
  layoutDirty = false
}

function drawCachedText(pageOffsetX: number, pageOffsetY: number): void {
  ctx.save()
  ctx.font = dims.font
  ctx.textBaseline = 'top'

  const fireActive = hasActiveFire(dragon)
  for (const line of cachedLines) {
    if (!fireActive) {
      ctx.fillStyle = TEXT_COLOR
      ctx.fillText(line.text, Math.round(line.x), Math.round(line.y))
    } else {
      drawCharsWithFire(line.text, line.x, line.y, pageOffsetX, pageOffsetY)
    }
  }

  ctx.restore()
}

// --- Main render loop ---
let scheduled = false

function render(now: number): void {
  scheduled = false

  const p = pageOffset()
  const dc = dropCapMetrics()

  // Update creature — head chases mouse, or perches on drop cap when idle
  const idle = now - lastMouseMoveTime > IDLE_THRESHOLD
  const cScale = getCreatureScale()
  const perchX = p.x + dims.margin + dc.width * 0.8
  const perchY = p.y + dims.margin - 70 * cScale
  const stepped = stepCreature(dragon, now, mouse.x, mouse.y, idle, perchX, perchY)
  if (mouseDown) spawnFireParticles(dragon)
  const fireActive = hasActiveFire(dragon)
  if (fireActive) stepFire(dragon, now)

  if (stepped || fireActive) layoutDirty = true

  const rectObstacles: RectObstacle[] = [
    { x: dims.margin - 4, y: dims.margin - 4, width: dc.width, height: dc.height },
  ]

  // Only recompute text layout when creature segments moved
  if (layoutDirty) recomputeTextLayout(rectObstacles, p.x, p.y)

  // --- Draw ---
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = BG_COLOR
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight)

  ctx.save()
  ctx.translate(p.x, p.y)

  drawDropCap()
  drawCachedText(p.x, p.y)

  ctx.restore()

  // Draw dragon and fire in world space
  drawFire(ctx, dragon)
  drawCreature(ctx, dragon)

  scheduleRender()
}

function scheduleRender(): void {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(render)
}

scheduleRender()
