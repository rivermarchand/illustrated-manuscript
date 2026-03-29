import { prepareWithSegments, layoutNextLine, type LayoutCursor, type PreparedTextWithSegments } from '@chenglou/pretext'
import { makeDragon, stepCreature, getCreatureIntervalsForBand, getFireIntervalsForBand, drawCreature, spawnFireParticles, stepFire, drawFire, hasActiveFire, getFireForce, type Creature } from './creature'
import { STORY_TEXT } from './text'

// --- Config ---
const PAGE_WIDTH = 700
const PAGE_HEIGHT = 960
const MARGIN = 60
const BODY_FONT = '18px "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, "Georgia", serif'
const LINE_HEIGHT = 30
const TEXT_COLOR = '#2a1a0a'
const DROP_CAP_FONT = '128px "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, "Georgia", serif'
const DROP_CAP_COLOR = '#8B0000'
const PARCHMENT_BASE = '#f4e4c1'
const BG_COLOR = '#2a1f14'

// --- Canvas: fills viewport ---
const canvas = document.getElementById('manuscript') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const dpr = window.devicePixelRatio || 1

function resizeCanvas(): void {
  canvas.width = window.innerWidth * dpr
  canvas.height = window.innerHeight * dpr
  canvas.style.width = `${window.innerWidth}px`
  canvas.style.height = `${window.innerHeight}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}
resizeCanvas()
window.addEventListener('resize', () => { resizeCanvas(); scheduleRender() })

// Page offset — centered in viewport
function pageOffset(): { x: number; y: number } {
  return {
    x: Math.round((window.innerWidth - PAGE_WIDTH) / 2),
    y: Math.round(Math.max(20, (window.innerHeight - PAGE_HEIGHT) / 2)),
  }
}

// --- State ---
const mouse = { x: 0, y: 0 }

canvas.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX
  mouse.y = e.clientY
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

// --- Creature (world coordinates) ---
const dragon: Creature = (() => {
  const p = pageOffset()
  return makeDragon(p.x + PAGE_WIDTH / 2, p.y + PAGE_HEIGHT / 3)
})()

// --- Prepare text ---
await document.fonts.ready

const dropCapChar = STORY_TEXT[0]!
const restText = STORY_TEXT.slice(1)
const preparedBody = prepareWithSegments(restText, BODY_FONT)

// --- Parchment texture (cached, page-local coordinates) ---
const parchmentCanvas = document.createElement('canvas')
parchmentCanvas.width = PAGE_WIDTH * dpr
parchmentCanvas.height = PAGE_HEIGHT * dpr
const parchmentCtx = parchmentCanvas.getContext('2d')!
parchmentCtx.scale(dpr, dpr)

function cacheParchment(): void {
  parchmentCtx.fillStyle = PARCHMENT_BASE
  parchmentCtx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)

  const imageData = parchmentCtx.getImageData(0, 0, PAGE_WIDTH * dpr, PAGE_HEIGHT * dpr)
  const data = imageData.data
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * 15
    data[i] = Math.min(255, Math.max(0, data[i]! + noise))
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1]! + noise))
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2]! + noise))
  }
  parchmentCtx.putImageData(imageData, 0, 0)

  const gradient = parchmentCtx.createRadialGradient(
    PAGE_WIDTH / 2, PAGE_HEIGHT / 2, PAGE_WIDTH * 0.3,
    PAGE_WIDTH / 2, PAGE_HEIGHT / 2, PAGE_WIDTH * 0.75
  )
  gradient.addColorStop(0, 'rgba(0,0,0,0)')
  gradient.addColorStop(1, 'rgba(80,50,20,0.15)')
  parchmentCtx.fillStyle = gradient
  parchmentCtx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT)

  parchmentCtx.strokeStyle = '#8B6914'
  parchmentCtx.lineWidth = 2
  const bm = 30
  parchmentCtx.strokeRect(bm, bm, PAGE_WIDTH - bm * 2, PAGE_HEIGHT - bm * 2)
  parchmentCtx.strokeStyle = 'rgba(139, 105, 20, 0.3)'
  parchmentCtx.lineWidth = 1
  parchmentCtx.strokeRect(bm + 6, bm + 6, PAGE_WIDTH - (bm + 6) * 2, PAGE_HEIGHT - (bm + 6) * 2)
}
cacheParchment()

// --- Drop cap (page-local) ---
function drawDropCap(): { width: number; height: number } {
  ctx.save()
  ctx.font = DROP_CAP_FONT
  ctx.fillStyle = DROP_CAP_COLOR
  ctx.textBaseline = 'top'

  const metrics = ctx.measureText(dropCapChar)
  const w = metrics.width + 12
  const h = LINE_HEIGHT * 4

  ctx.fillStyle = 'rgba(139, 0, 0, 0.06)'
  ctx.fillRect(MARGIN - 4, MARGIN - 4, w + 8, h + 8)

  ctx.fillStyle = DROP_CAP_COLOR
  ctx.font = DROP_CAP_FONT
  ctx.fillText(dropCapChar, MARGIN, MARGIN - 8)

  ctx.strokeStyle = 'rgba(139, 0, 0, 0.3)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(MARGIN - 4, MARGIN - 4, w + 8, h + 8)

  ctx.restore()
  return { width: w + 16, height: h + 8 }
}

function dropCapMetrics(): { width: number; height: number } {
  ctx.save()
  ctx.font = DROP_CAP_FONT
  const metrics = ctx.measureText(dropCapChar)
  ctx.restore()
  return { width: metrics.width + 28, height: LINE_HEIGHT * 4 + 8 }
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
  let slots: Slot[] = [{ left: MARGIN, right: PAGE_WIDTH - MARGIN }]

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

  // Carve fire particles
  const fireIntervals = getFireIntervalsForBand(dragon, worldBandTop, worldBandBottom, 6)
  for (const interval of fireIntervals) {
    slots = carveSlots(slots, interval.left - pageOffsetX, interval.right - pageOffsetX)
  }

  return slots.filter(s => s.right - s.left >= MIN_SLOT_WIDTH)
}

function layoutAndDrawText(rectObstacles: RectObstacle[], pageOffsetX: number, pageOffsetY: number): void {
  ctx.save()
  ctx.font = BODY_FONT
  ctx.fillStyle = TEXT_COLOR
  ctx.textBaseline = 'top'

  const fireActive = hasActiveFire(dragon)
  let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  let y = MARGIN

  while (y + LINE_HEIGHT <= PAGE_HEIGHT - MARGIN) {
    const slots = getLineSlots(y, LINE_HEIGHT, rectObstacles, pageOffsetX, pageOffsetY)

    if (slots.length === 0) {
      y += LINE_HEIGHT
      continue
    }

    let exhausted = false
    for (const slot of slots) {
      const width = slot.right - slot.left
      const line = layoutNextLine(preparedBody, cursor, width)
      if (line === null) { exhausted = true; break }

      if (!fireActive) {
        ctx.fillText(line.text, slot.left, y + (LINE_HEIGHT - 18) / 2)
      } else {
        drawCharsWithFire(line.text, slot.left, y + (LINE_HEIGHT - 18) / 2, pageOffsetX, pageOffsetY)
      }
      cursor = line.end
    }

    if (exhausted) break
    y += LINE_HEIGHT
  }

  ctx.restore()
}

function drawCharsWithFire(text: string, startX: number, y: number, pox: number, poy: number): void {
  let x = startX
  for (const char of text) {
    const cw = ctx.measureText(char).width
    const worldX = x + cw / 2 + pox
    const worldY = y + 9 + poy
    const force = getFireForce(dragon, worldX, worldY)

    if (force.strength < 0.01) {
      ctx.fillStyle = TEXT_COLOR
      ctx.globalAlpha = 1
      ctx.fillText(char, x, y)
    } else {
      const s = force.strength
      ctx.save()
      ctx.translate(x + cw / 2 + force.dx * s * 45, y + 9 + force.dy * s * 45)
      ctx.rotate(s * (force.dx > 0 ? 1 : -1) * 1.2)
      ctx.globalAlpha = Math.max(0, 1 - s * 0.8)
      const r = Math.round(42 + s * 200)
      const g = Math.round(26 + s * 80)
      const b = Math.round(10)
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.fillText(char, -cw / 2, -9)
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
  const lx = 38
  for (let y = 40; y < PAGE_HEIGHT - 40; y += 5) {
    const x = lx + Math.sin(y * 0.02) * 4
    if (y === 40) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  ctx.fillStyle = 'rgba(34, 85, 34, 0.15)'
  for (let y = 80; y < PAGE_HEIGHT - 80; y += 60 + Math.sin(y) * 20) {
    const x = lx + Math.sin(y * 0.02) * 4
    ctx.beginPath()
    ctx.ellipse(x - 6, y, 8, 4, -0.5, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.strokeStyle = 'rgba(34, 85, 34, 0.25)'
  ctx.beginPath()
  const rx = PAGE_WIDTH - 38
  for (let y = 40; y < PAGE_HEIGHT - 40; y += 5) {
    const x = rx + Math.sin(y * 0.025 + 1) * 4
    if (y === 40) ctx.moveTo(x, y)
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
  ctx.fillRect(px, py, PAGE_WIDTH, PAGE_HEIGHT)
  ctx.restore()
}

// --- Main render loop ---
let scheduled = false

function render(now: number): void {
  scheduled = false

  const p = pageOffset()

  // Update creature — head chases mouse, body follows
  const stepped = stepCreature(dragon, now, mouse.x, mouse.y)
  if (mouseDown) spawnFireParticles(dragon)
  const fireActive = hasActiveFire(dragon)
  if (fireActive) stepFire(dragon, now)

  // Build page-local rect obstacles (drop cap)
  const dc = dropCapMetrics()
  const rectObstacles: RectObstacle[] = [
    { x: MARGIN - 4, y: MARGIN - 4, width: dc.width, height: dc.height },
  ]

  // --- Draw ---
  ctx.fillStyle = BG_COLOR
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight)

  drawPageShadow(p.x, p.y)

  ctx.save()
  ctx.translate(p.x, p.y)

  ctx.drawImage(parchmentCanvas, 0, 0, PAGE_WIDTH, PAGE_HEIGHT)

  drawVines()
  drawDropCap()
  layoutAndDrawText(rectObstacles, p.x, p.y)

  ctx.restore()

  // Draw dragon and fire in world space
  drawFire(ctx, dragon)
  drawCreature(ctx, dragon)

  if (stepped || fireActive || mouseDown) scheduleRender()
}

function scheduleRender(): void {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(render)
}

scheduleRender()
