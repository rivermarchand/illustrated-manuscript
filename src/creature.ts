// Serpentine dragon — a chain of segments that follow each other.
// Head chases the mouse, each segment trails the one ahead.
// Rendered with sprite images from /dragon-sprites/.

export type Segment = {
  x: number
  y: number
  angle: number // facing direction
  width: number // visual width at this segment (for text wrapping)
}

export type FireParticle = {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  life: number     // 0..1, starts at 1
  maxLife: number   // total frames
  frame: number     // current animation frame
  color: number     // 0=yellow, 1=orange, 2=red
}

export type Creature = {
  segments: Segment[]
  jitterSeed: number
  lastStepTime: number
  stepInterval: number
  fire: FireParticle[]
  fireLastStep: number
}

// --- Sprite loading ---
// Pre-scaled canvases for fast drawing (avoids scaling large images every frame)
let headImg: CanvasImageSource
let tongueImg: CanvasImageSource
let bodyImgs: CanvasImageSource[] = []
let wingFrontImg: CanvasImageSource
let wingBackImg: CanvasImageSource
let fireImgs: CanvasImageSource[] = []

// Store scaled dimensions for each sprite
let headSize: { w: number; h: number }
let tongueSize: { w: number; h: number }
let bodySizes: { w: number; h: number }[] = []
let wingFrontSize: { w: number; h: number }
let wingBackSize: { w: number; h: number }
let fireSizes: { w: number; h: number }[] = []

const FIRE_SPRITE_COUNT = 10
const FIRE_SPRITE_SCALE = 0.12
const FIRE_SPRITE_NAMES = [
  'Layer 2', 'Layer 3', 'Layer 4', 'Layer 5', 'Layer 6',
  'Layer 7', 'Layer 8', 'Layer 9', 'Layer 10', 'Layer 11',
]

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function preScale(img: HTMLImageElement, scale: number): { canvas: OffscreenCanvas; w: number; h: number } {
  const w = Math.round(img.width * scale)
  const h = Math.round(img.height * scale)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, w, h)
  return { canvas, w, h }
}

export async function loadDragonSprites(): Promise<void> {
  const results = await Promise.all([
    loadImage('/dragon-sprites/head.png'),
    loadImage('/dragon-sprites/tongue.png'),
    loadImage('/dragon-sprites/wing-front.png'),
    loadImage('/dragon-sprites/wing-back.png'),
    ...Array.from({ length: 19 }, (_, i) => loadImage(`/dragon-sprites/body-${i + 1}.png`)),
  ])

  const s = SPRITE_SCALE
  let r: ReturnType<typeof preScale>

  r = preScale(results[0]!, s); headImg = r.canvas; headSize = { w: r.w, h: r.h }
  r = preScale(results[1]!, s); tongueImg = r.canvas; tongueSize = { w: r.w, h: r.h }
  r = preScale(results[2]!, s); wingFrontImg = r.canvas; wingFrontSize = { w: r.w, h: r.h }
  r = preScale(results[3]!, s); wingBackImg = r.canvas; wingBackSize = { w: r.w, h: r.h }

  for (let i = 4; i < results.length; i++) {
    r = preScale(results[i]!, s)
    bodyImgs.push(r.canvas)
    bodySizes.push({ w: r.w, h: r.h })
  }

  // Load fire particle sprites
  const fireResults = await Promise.all(
    FIRE_SPRITE_NAMES.map(name => loadImage(`/fire-sprites/${name}.png`))
  )
  for (const img of fireResults) {
    r = preScale(img, FIRE_SPRITE_SCALE)
    fireImgs.push(r.canvas)
    fireSizes.push({ w: r.w, h: r.h })
  }
}

// --- Config ---
const SEGMENT_COUNT = 20 // head (0) + 19 body segments
const SEGMENT_SPACING = 30
const SPRITE_SCALE = 0.24
const WING_SEGMENT = 5 // body index where wings attach (body-5, the widest)

// Perpendicular dimension (height) of each sprite, for collision/text-wrapping
const SPRITE_HEIGHTS = [
  221, // head
  130, 203, 223, 285, 299, 281, 224, 192, 174, // body 1–9
  191, 156, 155, 122, 126, 125, 107, 101, 101, 81, // body 10–19
]

function segmentWidth(i: number): number {
  if (i < SPRITE_HEIGHTS.length) {
    return SPRITE_HEIGHTS[i]! * SPRITE_SCALE
  }
  return 10
}

export function makeDragon(startX: number, startY: number): Creature {
  const segments: Segment[] = []
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    segments.push({
      x: startX,
      y: startY + i * SEGMENT_SPACING,
      angle: -Math.PI / 2,
      width: segmentWidth(i),
    })
  }
  return {
    segments,
    jitterSeed: Math.random() * 1000,
    lastStepTime: 0,
    stepInterval: 80,
    fire: [],
    fireLastStep: 0,
  }
}

// Generate idle pose: head on top of drop cap facing right, body curves down-left
function generateIdlePose(perchX: number, perchY: number): { x: number; y: number; angle: number }[] {
  const pose: { x: number; y: number; angle: number }[] = []
  // Head faces right (angle 0)
  const headAngle = 0

  pose.push({ x: perchX, y: perchY - 2, angle: headAngle })

  for (let i = 1; i < SEGMENT_COUNT; i++) {
    // Body trails left from head, curving downward
    const t = i / (SEGMENT_COUNT - 1)
    // Negative angle so segments go left and DOWN (sin negative = +y in canvas)
    const segAngle = -(t * (Math.PI / 2) * 1.4)
    const prev = pose[i - 1]!
    pose.push({
      x: prev.x - Math.cos(segAngle) * SEGMENT_SPACING,
      y: prev.y - Math.sin(segAngle) * SEGMENT_SPACING,
      angle: segAngle,
    })
  }
  return pose
}

export function stepCreature(creature: Creature, now: number, targetX: number, targetY: number, idle: boolean = false, perchX: number = 0, perchY: number = 0): boolean {
  if (now - creature.lastStepTime < creature.stepInterval) return false
  creature.lastStepTime = now
  creature.jitterSeed = Math.random() * 1000

  if (idle) {
    const pose = generateIdlePose(perchX, perchY)
    const lerpSpeed = 0.12
    for (let i = 0; i < creature.segments.length; i++) {
      const seg = creature.segments[i]!
      const target = pose[i]!
      seg.x += (target.x - seg.x) * lerpSpeed
      seg.y += (target.y - seg.y) * lerpSpeed
      let angleDiff = target.angle - seg.angle
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2
      seg.angle += angleDiff * lerpSpeed
    }
    return true
  }

  const head = creature.segments[0]!

  const dx = targetX - head.x
  const dy = targetY - head.y
  const dist = Math.sqrt(dx * dx + dy * dy)

  if (dist > 4) {
    const speed = Math.min(dist, Math.max(12, dist * 0.15))
    head.x += (dx / dist) * speed
    head.y += (dy / dist) * speed
    head.angle = Math.atan2(dy, dx)
  }

  const MAX_BEND = 0.25 // max angle change between adjacent segments (radians)

  for (let i = 1; i < creature.segments.length; i++) {
    const leader = creature.segments[i - 1]!
    const seg = creature.segments[i]!

    // Desired angle toward leader
    let desired = Math.atan2(leader.y - seg.y, leader.x - seg.x)

    // Constrain angle relative to leader's angle
    let diff = desired - leader.angle
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    if (diff > MAX_BEND) desired = leader.angle + MAX_BEND
    else if (diff < -MAX_BEND) desired = leader.angle - MAX_BEND

    seg.angle = desired

    // Position segment behind leader at constrained angle
    seg.x = leader.x - Math.cos(seg.angle) * SEGMENT_SPACING
    seg.y = leader.y - Math.sin(seg.angle) * SEGMENT_SPACING
  }

  return true
}

// --- Text wrapping: per-line intervals ---
export type Interval = { left: number; right: number }

export function getCreatureIntervalsForBand(
  creature: Creature,
  bandTop: number,
  bandBottom: number,
  padding: number,
): Interval[] {
  const intervals: Interval[] = []

  for (const seg of creature.segments) {
    const r = seg.width / 2 + padding
    if (seg.y + r < bandTop || seg.y - r > bandBottom) continue

    const bandCenter = (bandTop + bandBottom) / 2
    const dy = Math.abs(seg.y - bandCenter)
    const bandHalf = (bandBottom - bandTop) / 2
    const closest = Math.max(0, dy - bandHalf)
    if (closest >= r) continue
    const xExtent = Math.sqrt(r * r - closest * closest)

    intervals.push({ left: seg.x - xExtent, right: seg.x + xExtent })
  }

  if (intervals.length <= 1) return intervals

  intervals.sort((a, b) => a.left - b.left)
  const merged: Interval[] = [intervals[0]!]
  for (let i = 1; i < intervals.length; i++) {
    const cur = intervals[i]!
    const last = merged[merged.length - 1]!
    if (cur.left <= last.right) {
      last.right = Math.max(last.right, cur.right)
    } else {
      merged.push(cur)
    }
  }
  return merged
}

// --- Drawing with sprites ---
export function drawCreature(ctx: CanvasRenderingContext2D, creature: Creature): void {
  const segs = creature.segments
  const jitter = creature.jitterSeed
  const wingTime = performance.now() / 1000

  // 1. Draw wing-back behind everything
  if (wingBackImg) {
    const wingSeg = segs[WING_SEGMENT]!
    const j = pseudoRandom(jitter + WING_SEGMENT * 37)
    const jx = (j - 0.5) * 1.5
    const jy = (pseudoRandom(jitter + WING_SEGMENT * 37 + 100) - 0.5) * 1.5
    const jAngle = (pseudoRandom(jitter + WING_SEGMENT * 37 + 200) - 0.5) * 0.04
    const wingFlap = Math.sin(wingTime * 3) * 0.4

    ctx.save()
    ctx.translate(wingSeg.x + jx, wingSeg.y + jy)
    ctx.rotate(wingSeg.angle + jAngle + wingFlap)
    const { w: ww, h: wh } = wingBackSize
    ctx.drawImage(wingBackImg, 0, 0, ww, wh, -ww, -wh, ww, wh)
    ctx.restore()
  }

  // 2. Draw body segments (tail to head) with wing-front on top
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i]!
    const j = pseudoRandom(jitter + i * 37)
    const jx = (j - 0.5) * 1.5
    const jy = (pseudoRandom(jitter + i * 37 + 100) - 0.5) * 1.5
    const jAngle = (pseudoRandom(jitter + i * 37 + 200) - 0.5) * 0.04

    ctx.save()
    ctx.translate(seg.x + jx, seg.y + jy)
    ctx.rotate(seg.angle + jAngle)

    if (i === 0) {
      if (tongueImg) {
        const { w: tw, h: th } = tongueSize
        ctx.drawImage(tongueImg, 0, 0, tw, th, headSize.w * 0.3, -th / 2, tw, th)
      }
      if (headImg) {
        const { w: hw, h: hh } = headSize
        ctx.drawImage(headImg, 0, 0, hw, hh, -hw * 0.45, -hh / 2, hw, hh)
      }
    } else {
      const bodyIdx = i - 1
      const bodyImg = bodyImgs[bodyIdx]
      const bodySize = bodySizes[bodyIdx]

      if (bodyImg && bodySize) {
        const { w: sw, h: sh } = bodySize
        ctx.drawImage(bodyImg, 0, 0, sw, sh, -sw / 2, -sh / 2, sw, sh)
      }

      if (i === WING_SEGMENT && wingFrontImg) {
        const wingFlap = Math.sin(wingTime * 3 + 0.5) * 0.4
        ctx.save()
        const { w: ww, h: wh } = wingFrontSize
        ctx.rotate(-wingFlap)
        ctx.drawImage(wingFrontImg, 0, 0, ww, wh, -ww, -wh, ww, wh)
        ctx.restore()
      }
    }

    ctx.restore()
  }
}

// --- Fire breath system ---
const FIRE_PALETTE = ['#C4402A', '#E08A30', '#F0C030'] // red, orange, gold
const FIRE_STEP_INTERVAL = 80

export function spawnFireParticles(creature: Creature): void {
  const head = creature.segments[0]!
  const snoutDist = (headImg ? headImg.width * SPRITE_SCALE * 0.55 : 30)
  const snoutX = head.x + Math.cos(head.angle) * snoutDist
  const snoutY = head.y + Math.sin(head.angle) * snoutDist

  const count = 3 + Math.floor(Math.random() * 3)
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * 0.25
    const speed = 35 + Math.random() * 20
    const angle = head.angle + spread

    creature.fire.push({
      x: snoutX + (Math.random() - 0.5) * 4,
      y: snoutY + (Math.random() - 0.5) * 4,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 8 + Math.random() * 12,
      life: 1,
      maxLife: 12 + Math.floor(Math.random() * 6),
      frame: 0,
      color: Math.floor(Math.random() * 3),
    })
  }
}

export function hasActiveFire(creature: Creature): boolean {
  return creature.fire.length > 0
}

export function stepFire(creature: Creature, now: number): void {
  if (now - creature.fireLastStep < FIRE_STEP_INTERVAL) return
  creature.fireLastStep = now

  for (let i = creature.fire.length - 1; i >= 0; i--) {
    const p = creature.fire[i]!
    p.frame++
    p.life = 1 - p.frame / p.maxLife

    p.x += p.vx
    p.y += p.vy

    p.vx *= 0.95
    p.vy *= 0.95

    // Drift upward only after traveling straight for a bit
    const drift = Math.max(0, (p.frame - 4) / p.maxLife)
    p.vy -= drift * 1.5

    if (p.life < 0.25) {
      p.size *= 0.75
    } else if (p.frame < 3) {
      p.size *= 1.15
    }

    if (p.life <= 0 || p.size < 1.5) {
      creature.fire.splice(i, 1)
    }
  }
}

// Draw a wobbly line between two points with subdivided jitter
function wobbleLine(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
  seed: number, roughness: number,
) {
  const steps = 4
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const jx = (pseudoRandom(seed + i * 13) - 0.5) * roughness
    const jy = (pseudoRandom(seed + i * 29) - 0.5) * roughness
    ctx.lineTo(x1 + (x2 - x1) * t + jx, y1 + (y2 - y1) * t + jy)
  }
}

export function drawFire(ctx: CanvasRenderingContext2D, creature: Creature): void {
  for (const p of creature.fire) {
    const velocityAngle = Math.atan2(p.vy, p.vx)

    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(velocityAngle)
    ctx.globalAlpha = Math.min(1, p.life * 1.5)
    // Transition red → orange → gold as particle ages
    const age = 1 - p.life // 0 = new, 1 = dying
    const colorIdx = age < 0.33 ? 0 : age < 0.66 ? 1 : 2
    ctx.fillStyle = FIRE_PALETTE[colorIdx]!

    const s = p.size / 2
    const seed = p.color * 31 + p.frame * 0.3
    const jit = (i: number) => (pseudoRandom(seed + i * 17) - 0.5) * s * 0.4
    const roughness = s * 0.35

    // Diamond vertices
    const verts = [
      [s * 1.2 + jit(0), jit(1)],         // right tip (leading)
      [jit(2), -s * 0.7 + jit(3)],        // top
      [-s + jit(4), jit(5)],              // left
      [jit(6), s * 0.7 + jit(7)],         // bottom
    ]

    // Build wobbly path
    ctx.beginPath()
    ctx.moveTo(verts[0]![0], verts[0]![1])
    for (let i = 0; i < 4; i++) {
      const next = verts[(i + 1) % 4]!
      wobbleLine(ctx, verts[i]![0], verts[i]![1], next[0], next[1], seed + i * 100, roughness)
    }
    ctx.closePath()

    ctx.fill()

    ctx.globalAlpha = 1
    ctx.restore()
  }
}

export function getFireForce(
  creature: Creature,
  worldX: number,
  worldY: number,
): { dx: number; dy: number; strength: number } {
  let totalDx = 0
  let totalDy = 0
  let totalStrength = 0
  const FIRE_RADIUS = 60

  for (const p of creature.fire) {
    const dx = worldX - p.x
    const dy = worldY - p.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (dist > FIRE_RADIUS || dist < 0.1) continue

    const falloff = 1 - dist / FIRE_RADIUS
    const strength = falloff * falloff * p.life
    const ndx = dx / dist
    const ndy = dy / dist

    totalDx += ndx * strength
    totalDy += ndy * strength
    totalStrength += strength
  }

  if (totalStrength < 0.001) return { dx: 0, dy: 0, strength: 0 }

  const len = Math.sqrt(totalDx * totalDx + totalDy * totalDy)
  return {
    dx: len > 0 ? totalDx / len : 0,
    dy: len > 0 ? totalDy / len : 0,
    strength: Math.min(totalStrength, 1.5),
  }
}

export function getFireIntervalsForBand(
  creature: Creature,
  bandTop: number,
  bandBottom: number,
  padding: number,
): Interval[] {
  const intervals: Interval[] = []

  for (const p of creature.fire) {
    const r = p.size / 2 + padding
    if (p.y + r < bandTop || p.y - r > bandBottom) continue

    const bandCenter = (bandTop + bandBottom) / 2
    const dy = Math.abs(p.y - bandCenter)
    const bandHalf = (bandBottom - bandTop) / 2
    const closest = Math.max(0, dy - bandHalf)
    if (closest >= r) continue
    const xExtent = Math.sqrt(r * r - closest * closest)
    intervals.push({ left: p.x - xExtent, right: p.x + xExtent })
  }

  if (intervals.length <= 1) return intervals
  intervals.sort((a, b) => a.left - b.left)
  const merged: Interval[] = [intervals[0]!]
  for (let i = 1; i < intervals.length; i++) {
    const cur = intervals[i]!
    const last = merged[merged.length - 1]!
    if (cur.left <= last.right) {
      last.right = Math.max(last.right, cur.right)
    } else {
      merged.push(cur)
    }
  }
  return merged
}

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
  return x - Math.floor(x)
}
