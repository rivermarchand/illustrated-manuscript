// Serpentine dragon — a chain of segments that follow each other.
// Head chases the mouse, each segment trails the one ahead.

export type Segment = {
  x: number
  y: number
  angle: number // facing direction
  width: number // visual width at this segment
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

const SEGMENT_COUNT = 24
const SEGMENT_SPACING = 18
const HEAD_WIDTH = 32
const NECK_WIDTH = 22
const BODY_WIDTH = 28
const TAIL_WIDTH = 6

function segmentWidth(i: number): number {
  if (i === 0) return HEAD_WIDTH
  if (i === 1) return NECK_WIDTH
  if (i < 5) return BODY_WIDTH
  // Taper toward tail
  const t = (i - 5) / (SEGMENT_COUNT - 5)
  return BODY_WIDTH * (1 - t) + TAIL_WIDTH * t
}

export function makeDragon(startX: number, startY: number): Creature {
  const segments: Segment[] = []
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    segments.push({
      x: startX,
      y: startY + i * SEGMENT_SPACING,
      angle: -Math.PI / 2, // facing up
      width: segmentWidth(i),
    })
  }
  return {
    segments,
    jitterSeed: Math.random() * 1000,
    lastStepTime: 0,
    stepInterval: 80, // ~12fps
    fire: [],
    fireLastStep: 0,
  }
}

export function stepCreature(creature: Creature, now: number, targetX: number, targetY: number): boolean {
  if (now - creature.lastStepTime < creature.stepInterval) return false
  creature.lastStepTime = now
  creature.jitterSeed = Math.random() * 1000

  const head = creature.segments[0]!

  // Head chases target
  const dx = targetX - head.x
  const dy = targetY - head.y
  const dist = Math.sqrt(dx * dx + dy * dy)

  if (dist > 4) {
    const speed = Math.min(dist, Math.max(12, dist * 0.15))
    head.x += (dx / dist) * speed
    head.y += (dy / dist) * speed
    head.angle = Math.atan2(dy, dx)
  }

  // Each subsequent segment follows the one ahead
  for (let i = 1; i < creature.segments.length; i++) {
    const leader = creature.segments[i - 1]!
    const seg = creature.segments[i]!
    const fx = leader.x - seg.x
    const fy = leader.y - seg.y
    const fd = Math.sqrt(fx * fx + fy * fy)

    if (fd > SEGMENT_SPACING) {
      const pull = fd - SEGMENT_SPACING
      seg.x += (fx / fd) * pull
      seg.y += (fy / fd) * pull
    }
    seg.angle = Math.atan2(leader.y - seg.y, leader.x - seg.x)
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
    // Treat each segment as a circle — find x-extent within the band
    if (seg.y + r < bandTop || seg.y - r > bandBottom) continue

    // Circle-band intersection: x-extent at the closest/widest point
    const bandCenter = (bandTop + bandBottom) / 2
    const dy = Math.abs(seg.y - bandCenter)
    const bandHalf = (bandBottom - bandTop) / 2
    // Use the widest intersection across the entire band
    const closest = Math.max(0, dy - bandHalf)
    if (closest >= r) continue
    const xExtent = Math.sqrt(r * r - closest * closest)

    intervals.push({ left: seg.x - xExtent, right: seg.x + xExtent })
  }

  if (intervals.length <= 1) return intervals

  // Merge overlapping
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

// --- Drawing ---
export function drawCreature(ctx: CanvasRenderingContext2D, creature: Creature): void {
  const segs = creature.segments
  const jitter = creature.jitterSeed

  // Draw back to front so head is on top
  // Body segments
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
      drawHead(ctx, seg.width, jitter)
    } else {
      drawBodySegment(ctx, seg.width, i, segs.length)
    }

    // Small wings on segments 3 and 4
    if (i === 3 || i === 4) {
      drawWings(ctx, seg.width, i, jitter)
    }

    ctx.restore()
  }
}

function drawHead(ctx: CanvasRenderingContext2D, w: number, jitter: number): void {
  const hw = w / 2
  const hl = w * 0.7

  // Head shape — slightly pointed
  ctx.fillStyle = '#A0522D'
  ctx.shadowColor = 'rgba(0,0,0,0.3)'
  ctx.shadowBlur = 4
  ctx.shadowOffsetX = 2
  ctx.shadowOffsetY = 2

  ctx.beginPath()
  ctx.moveTo(hl + 8, 0) // snout tip
  ctx.lineTo(hl * 0.3, -hw)
  ctx.lineTo(-hl, -hw * 0.8)
  ctx.lineTo(-hl, hw * 0.8)
  ctx.lineTo(hl * 0.3, hw)
  ctx.closePath()
  ctx.fill()

  ctx.shadowColor = 'transparent'

  // Eye
  ctx.fillStyle = '#1a0a00'
  ctx.beginPath()
  ctx.arc(hl * 0.15, -hw * 0.35, 3, 0, Math.PI * 2)
  ctx.fill()

  // Nostril
  ctx.fillStyle = '#5a2d0c'
  ctx.beginPath()
  ctx.arc(hl * 0.6, -hw * 0.15, 2, 0, Math.PI * 2)
  ctx.fill()

  // Horns
  ctx.fillStyle = '#DEB887'
  ctx.save()
  ctx.translate(-hl * 0.2, -hw * 0.7)
  ctx.rotate(-0.6)
  ctx.fillRect(-2, -18, 5, 18)
  ctx.restore()

  ctx.save()
  ctx.translate(-hl * 0.2, hw * 0.7)
  ctx.rotate(0.6)
  ctx.fillRect(-2, 0, 5, 18)
  ctx.restore()

  // Jaw line
  ctx.strokeStyle = '#6B3410'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(hl + 6, 1)
  ctx.lineTo(hl * 0.1, hw * 0.5)
  ctx.stroke()
}

function drawBodySegment(ctx: CanvasRenderingContext2D, w: number, index: number, total: number): void {
  const hw = w / 2
  const hl = SEGMENT_SPACING * 0.55

  // Alternate slightly between two browns for scale-like feel
  ctx.fillStyle = index % 2 === 0 ? '#8B4513' : '#7a3b10'
  ctx.shadowColor = 'rgba(0,0,0,0.2)'
  ctx.shadowBlur = 3
  ctx.shadowOffsetX = 1
  ctx.shadowOffsetY = 2

  // Rounded body segment
  ctx.beginPath()
  ctx.ellipse(0, 0, hl, hw, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.shadowColor = 'transparent'

  // Scale texture — subtle chevron marks
  if (w > 12) {
    ctx.strokeStyle = 'rgba(0,0,0,0.1)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(hl * 0.3, -hw * 0.4)
    ctx.lineTo(hl * 0.5, 0)
    ctx.lineTo(hl * 0.3, hw * 0.4)
    ctx.stroke()
  }

  // Tail fin on last segment
  if (index === total - 1) {
    ctx.fillStyle = '#6B3410'
    ctx.beginPath()
    ctx.moveTo(-hl, 0)
    ctx.lineTo(-hl - 20, -12)
    ctx.lineTo(-hl - 8, 0)
    ctx.lineTo(-hl - 20, 12)
    ctx.closePath()
    ctx.fill()
  }
}

function drawWings(ctx: CanvasRenderingContext2D, w: number, index: number, jitter: number): void {
  const wingFlap = Math.sin(jitter * 0.1 + index) * 0.3
  const hw = w / 2

  ctx.fillStyle = '#6B3410'
  ctx.shadowColor = 'rgba(0,0,0,0.2)'
  ctx.shadowBlur = 3

  // Top wing
  ctx.save()
  ctx.translate(0, -hw)
  ctx.rotate(-0.8 + wingFlap)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(15, -35)
  ctx.lineTo(25, -20)
  ctx.lineTo(10, -10)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  // Bottom wing
  ctx.save()
  ctx.translate(0, hw)
  ctx.rotate(0.8 - wingFlap)
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(15, 35)
  ctx.lineTo(25, 20)
  ctx.lineTo(10, 10)
  ctx.closePath()
  ctx.fill()
  ctx.restore()

  ctx.shadowColor = 'transparent'
}

// --- Fire breath system ---
const FIRE_COLORS = [
  ['#FFE44D', '#FFD700', '#FFC800'], // yellow (core)
  ['#FF8C00', '#FF6B00', '#FF5500'], // orange (mid)
  ['#FF3300', '#CC2200', '#AA1100'], // red (edges)
]
const FIRE_STEP_INTERVAL = 80 // match body framerate

// Spawn a few particles per frame — called every render while mouse is held
export function spawnFireParticles(creature: Creature): void {
  const head = creature.segments[0]!
  const snoutDist = head.width * 0.7 + 8
  const snoutX = head.x + Math.cos(head.angle) * snoutDist
  const snoutY = head.y + Math.sin(head.angle) * snoutDist

  // 3-5 particles per frame for a thick stream
  const count = 3 + Math.floor(Math.random() * 3)
  for (let i = 0; i < count; i++) {
    const spread = (Math.random() - 0.5) * 0.35 // tight cone
    const speed = 18 + Math.random() * 12 // fast!
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
      color: Math.random() < 0.3 ? 0 : Math.random() < 0.6 ? 1 : 2,
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

    // Move fast in discrete steps
    p.x += p.vx
    p.y += p.vy

    // Slight deceleration, slight upward drift
    p.vx *= 0.93
    p.vy *= 0.93
    p.vy -= 0.8

    // Grow at start, shrink at end
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

export function drawFire(ctx: CanvasRenderingContext2D, creature: Creature): void {
  for (const p of creature.fire) {
    const colors = FIRE_COLORS[p.color]!
    // Pick shade based on life — bright when new, dark when dying
    const shade = p.life > 0.6 ? 0 : p.life > 0.3 ? 1 : 2
    const jx = (pseudoRandom(p.frame * 17 + p.color * 7) - 0.5) * 4
    const jy = (pseudoRandom(p.frame * 31 + p.color * 13) - 0.5) * 4
    const jAngle = (pseudoRandom(p.frame * 53 + p.color * 3) - 0.5) * 0.5

    ctx.save()
    ctx.translate(p.x + jx, p.y + jy)
    ctx.rotate(jAngle)

    // Draw as a rough, wobbly diamond/flame shape
    ctx.fillStyle = colors[shade]!
    ctx.globalAlpha = Math.min(1, p.life * 1.5)
    ctx.shadowColor = colors[0]!
    ctx.shadowBlur = p.size * 0.6

    const s = p.size / 2
    const w = () => (pseudoRandom(p.frame * 7 + s) - 0.5) * 3
    ctx.beginPath()
    ctx.moveTo(0 + w(), -s + w())
    ctx.lineTo(s * 0.7 + w(), 0 + w())
    ctx.lineTo(0 + w(), s * 1.2 + w())
    ctx.lineTo(-s * 0.7 + w(), 0 + w())
    ctx.closePath()
    ctx.fill()

    // Inner bright core
    if (p.life > 0.4) {
      ctx.fillStyle = '#FFF8E0'
      ctx.globalAlpha = (p.life - 0.4) * 1.2
      ctx.beginPath()
      ctx.arc(0, 0, s * 0.25, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.globalAlpha = 1
    ctx.shadowColor = 'transparent'
    ctx.restore()
  }
}

// Compute the force fire exerts on a point in world space.
// Returns a direction (dx, dy normalized) and strength (0..1+).
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
    const strength = falloff * falloff * p.life // quadratic falloff, scaled by particle life
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
