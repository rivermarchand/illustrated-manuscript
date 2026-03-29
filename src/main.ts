import { prepareWithSegments, layoutNextLine, type LayoutCursor, type PreparedTextWithSegments } from '@chenglou/pretext'
import { loadDragonSprites, makeDragon, updateCreatureScale, stepCreature, getCreatureIntervalsForBand, getFireIntervalsForBand, drawCreature, spawnFireParticles, stepFire, drawFire, hasActiveFire, type Creature } from './creature'
import { STORY_TEXT } from './text'

// --- Responsive config ---
const BASE_PAGE_WIDTH = 700
const BASE_MARGIN = 45
const BASE_FONT_SIZE = 21
const BASE_LINE_HEIGHT = 34
const FONT_FAMILY = '"Furia", "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, "Georgia", serif'
const TEXT_COLOR = '#2a1a0a'

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

// --- Canvas: transparent, for dragon + fire only ---
const canvas = document.getElementById('manuscript') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!

function resizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.round(window.innerWidth * dpr)
  canvas.height = Math.round(window.innerHeight * dpr)
  canvas.style.width = `${window.innerWidth}px`
  canvas.style.height = `${window.innerHeight}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
}
resizeCanvas()

// --- DOM elements for text + drop cap ---
const dropCapEl = document.getElementById('drop-cap') as HTMLImageElement
const textOverlay = document.getElementById('text-overlay')!
let textSpans: HTMLSpanElement[] = []

function updateDropCap(px: number, py: number): void {
  const dc = getDropCapSize()
  dropCapEl.style.left = `${px + dims.margin}px`
  dropCapEl.style.top = `${py + dims.margin}px`
  dropCapEl.style.width = `${dc.drawWidth}px`
  dropCapEl.style.height = `${dc.drawHeight}px`
  dropCapEl.style.visibility = 'visible'
}

function updateTextOverlay(px: number, py: number): void {
  textOverlay.style.transform = `translate(${px}px, ${py}px)`
  textOverlay.style.font = dims.font
  textOverlay.style.color = TEXT_COLOR

  // Reuse or create spans as needed
  while (textSpans.length < cachedLines.length) {
    const span = document.createElement('span')
    textOverlay.appendChild(span)
    textSpans.push(span)
  }

  for (let i = 0; i < cachedLines.length; i++) {
    const line = cachedLines[i]!
    const span = textSpans[i]!
    span.textContent = line.text
    span.style.left = `${Math.round(line.x)}px`
    span.style.top = `${Math.round(line.y)}px`
    span.style.display = ''
  }

  for (let i = cachedLines.length; i < textSpans.length; i++) {
    textSpans[i]!.style.display = 'none'
  }
}

// --- Resize ---
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

const restText = STORY_TEXT.slice(1)
let preparedBody = prepareWithSegments(restText, dims.font)
let lastPreparedFontSize = dims.fontSize

function ensureTextPrepared(): void {
  if (dims.fontSize !== lastPreparedFontSize) {
    preparedBody = prepareWithSegments(restText, dims.font)
    lastPreparedFontSize = dims.fontSize
  }
}

// --- Drop cap ---
await new Promise<void>((resolve, reject) => {
  if (dropCapEl.complete && dropCapEl.naturalWidth > 0) { resolve(); return }
  dropCapEl.onload = () => resolve()
  dropCapEl.onerror = () => reject(new Error('Drop cap failed to load'))
})

function getDropCapSize(): { width: number; height: number; drawWidth: number; drawHeight: number } {
  const drawHeight = dims.lineHeight * 7
  const drawWidth = dropCapEl.naturalWidth * (drawHeight / dropCapEl.naturalHeight)
  return { width: drawWidth + 12, height: drawHeight, drawWidth, drawHeight }
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

  if (layoutDirty) {
    recomputeTextLayout(rectObstacles, p.x, p.y)
    updateDropCap(p.x, p.y)
    updateTextOverlay(p.x, p.y)
  }

  // --- Draw: canvas only handles dragon + fire ---
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)

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
