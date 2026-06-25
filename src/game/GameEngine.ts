import { gameAudio } from './audio'

const FRUITS = ['🍉', '🍊', '🍎', '🍋', '🍇', '🍍', '🍓', '🥝'] as const

/** Juice tint per fruit emoji, used for particle bursts. */
const JUICE_COLORS: Record<string, string> = {
  '🍉': '#ff4d6d',
  '🍊': '#ff9f1c',
  '🍎': '#ef233c',
  '🍋': '#ffe169',
  '🍇': '#9d4edd',
  '🍍': '#ffd60a',
  '🍓': '#ff5d8f',
  '🥝': '#80b918',
}

const GRAVITY = 0.32
const VELOCITY_THRESHOLD = 16 // px/frame to count as a normal slice swipe
const LONG_BLADE_THRESHOLD = 7 // gentler swipes cut in open-hand mode
const LONG_BLADE_HALF = 170 // half-length (px) of the open-hand blade
const TRAIL_LIFE = 15 // frames a blade-trail point lives
// Fingertip smoothing: low-pass filter to kill MediaPipe jitter (lower = smoother
// but laggier). Jumps beyond JUMP_BREAK in one frame are treated as a detection
// glitch/re-acquire and snap instead of drawing a spike ("star") across screen.
const SMOOTH_ALPHA = 0.45
const JUMP_BREAK = 320
// Slicing keeps the cut continuous across brief tracking drops: the last known
// fingertip is remembered for up to SLICE_BRIDGE_FRAMES so a fast swipe stays one
// unbroken blade instead of a dashed line of stabs. A single-frame jump beyond
// SLICE_BREAK is a genuine re-acquire (hand re-appeared elsewhere), not a swipe,
// so we don't drag a cut across the whole screen.
const SLICE_BRIDGE_FRAMES = 4
const SLICE_BREAK = 600

interface Fruit {
  x: number
  y: number
  vx: number
  vy: number
  emoji: string
  radius: number
  rotation: number
  rotSpeed: number
  sliced: boolean
  countedMiss: boolean
}

interface Half {
  x: number
  y: number
  vx: number
  vy: number
  emoji: string
  radius: number
  rotation: number
  rotSpeed: number
  top: boolean // upper or lower half
  life: number // 1 -> 0
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  life: number // 1 -> 0
}

interface TrailPoint {
  x: number
  y: number
  life: number // frames remaining
}

export interface EngineCallbacks {
  onScoreChange?: (score: number) => void
  onLivesChange?: (lives: number) => void
  onGameOver?: (finalScore: number) => void
}

export class GameEngine {
  private ctx: CanvasRenderingContext2D
  readonly width: number
  readonly height: number

  private fruits: Fruit[] = []
  private halves: Half[] = []
  private particles: Particle[] = []
  private trail: TrailPoint[] = []

  private tip = {
    x: 0,
    y: 0,
    prevX: 0,
    prevY: 0,
    detected: false,
    hadPrev: false,
    long: false, // open-hand "long blade" mode
    lastX: 0, // last known position, persists across brief detection drops
    lastY: 0,
    hasLast: false,
    lostFrames: 0, // consecutive frames with no hand
  }
  private smooth = { x: 0, y: 0, has: false } // low-pass filter state

  private score = 0
  private lives = 3
  private running = false
  private spawnTimer = 0
  private spawnInterval = 1100 // ms
  private lastTime = 0

  private cb: EngineCallbacks

  constructor(canvas: HTMLCanvasElement, cb: EngineCallbacks = {}) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    this.ctx = ctx
    this.width = canvas.width
    this.height = canvas.height
    this.cb = cb
  }

  reset(): void {
    this.fruits = []
    this.halves = []
    this.particles = []
    this.trail = []
    this.score = 0
    this.lives = 3
    this.spawnTimer = 0
    this.spawnInterval = 1100
    this.lastTime = 0
    this.tip.hadPrev = false
    this.tip.detected = false
    this.tip.hasLast = false
    this.tip.lostFrames = 0
    this.smooth.has = false
    this.cb.onScoreChange?.(this.score)
    this.cb.onLivesChange?.(this.lives)
  }

  start(): void {
    this.running = true
    this.lastTime = performance.now()
  }

  stop(): void {
    this.running = false
  }

  /**
   * Update fingertip position in canvas pixel space (already mirrored).
   * Pass detected=false when no hand is visible. `long` enables the wide
   * open-hand blade.
   */
  updateFingertip(rawX: number, rawY: number, detected: boolean, long = false): void {
    this.tip.long = detected && long

    if (!detected) {
      this.tip.detected = false
      this.tip.lostFrames++
      // Forget the bridge only after a sustained loss; brief flickers during a
      // fast swipe are bridged so the cut stays continuous (see below).
      if (this.tip.lostFrames > SLICE_BRIDGE_FRAMES) {
        this.tip.hasLast = false
        this.smooth.has = false // re-acquire fresh next time
      }
      return
    }

    // SLICING uses the RAW fingertip — no smoothing lag, so the cut happens
    // exactly where your finger (and the webcam image) is. We build the cutting
    // segment from the LAST KNOWN tip to the new one, persisting it across brief
    // tracking drops, so dragging a straight line across the screen cuts every
    // fruit along the path instead of leaving gaps wherever a frame flickered.
    if (this.tip.hasLast) {
      const gap = Math.hypot(rawX - this.tip.lastX, rawY - this.tip.lastY)
      // A jump beyond SLICE_BREAK is a re-acquire elsewhere, not a swipe — start
      // fresh so we don't drag a cut clear across the screen.
      this.tip.hadPrev = gap <= SLICE_BREAK
      this.tip.prevX = this.tip.lastX
      this.tip.prevY = this.tip.lastY
    } else {
      this.tip.hadPrev = false
    }
    this.tip.x = rawX
    this.tip.y = rawY
    this.tip.lastX = rawX
    this.tip.lastY = rawY
    this.tip.hasLast = true
    this.tip.detected = true
    this.tip.lostFrames = 0

    // The VISUAL trail uses a smoothed point (no jitter), and snaps + clears on
    // a one-frame teleport so we never draw a spike ("star"). Rendering only —
    // this never affects whether a slice registers.
    if (!this.smooth.has) {
      this.smooth.x = rawX
      this.smooth.y = rawY
      this.smooth.has = true
      this.trail.length = 0
    } else {
      const dx = rawX - this.smooth.x
      const dy = rawY - this.smooth.y
      if (Math.hypot(dx, dy) > JUMP_BREAK) {
        this.smooth.x = rawX
        this.smooth.y = rawY
        this.trail.length = 0
      } else {
        this.smooth.x += dx * SMOOTH_ALPHA
        this.smooth.y += dy * SMOOTH_ALPHA
      }
    }
  }

  /** Advance one frame and render. Returns false once the game is over. */
  tick(now: number): boolean {
    const dt = Math.min(50, now - this.lastTime) // clamp big gaps (tab switch)
    this.lastTime = now

    if (this.running) {
      this.updateBlade()
      this.spawnLogic(dt)
      this.updateFruits()
      this.updateHalves()
      this.updateParticles()
      this.detectSlices()
    }
    this.updateTrail()
    this.render()

    return this.running
  }

  // ---- fingertip / blade ----

  private updateBlade(): void {
    if (this.tip.detected && this.smooth.has) {
      // Smoothed point for a clean visual tail (slicing uses the raw tip).
      this.trail.push({ x: this.smooth.x, y: this.smooth.y, life: TRAIL_LIFE })
      if (this.trail.length > 22) this.trail.shift()
    }
  }

  private updateTrail(): void {
    for (const p of this.trail) p.life--
    this.trail = this.trail.filter((p) => p.life > 0)
  }

  private bladeVelocity(): number {
    if (!this.tip.detected || !this.tip.hadPrev) return 0
    const dx = this.tip.x - this.tip.prevX
    const dy = this.tip.y - this.tip.prevY
    return Math.hypot(dx, dy)
  }

  // ---- spawning ----

  private spawnLogic(dt: number): void {
    this.spawnTimer += dt
    if (this.spawnTimer >= this.spawnInterval) {
      this.spawnTimer = 0
      this.spawnFruit()
      // occasionally a double spawn at higher difficulty
      if (this.spawnInterval < 680 && Math.random() < 0.25) this.spawnFruit()
    }
  }

  private spawnFruit(): void {
    const emoji = FRUITS[Math.floor(Math.random() * FRUITS.length)]
    const margin = this.width * 0.15
    const x = margin + Math.random() * (this.width - margin * 2)
    // Launch upward; aim roughly toward center-top so it arcs across.
    const speedBoost = Math.max(0, (this.score - 100) / 100) * 1.5
    const vy = -(13 + Math.random() * 3 + speedBoost)
    const towardCenter = (this.width / 2 - x) / this.width
    const vx = towardCenter * 6 + (Math.random() - 0.5) * 4
    this.fruits.push({
      x,
      y: this.height + 40,
      vx,
      vy,
      emoji,
      radius: 38,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.08,
      sliced: false,
      countedMiss: false,
    })
  }

  // ---- physics updates ----

  private updateFruits(): void {
    for (const f of this.fruits) {
      f.vy += GRAVITY
      f.x += f.vx
      f.y += f.vy
      f.rotation += f.rotSpeed
    }
    // Miss detection: a falling, unsliced fruit that exits the bottom.
    for (const f of this.fruits) {
      if (!f.sliced && !f.countedMiss && f.vy > 0 && f.y - f.radius > this.height) {
        f.countedMiss = true
        this.loseLife()
      }
    }
    // Cull off-screen fruits.
    this.fruits = this.fruits.filter(
      (f) => f.y - f.radius <= this.height + 80 && f.x > -120 && f.x < this.width + 120,
    )
  }

  private updateHalves(): void {
    for (const h of this.halves) {
      h.vy += GRAVITY
      h.x += h.vx
      h.y += h.vy
      h.rotation += h.rotSpeed
      h.life -= 0.012
    }
    this.halves = this.halves.filter((h) => h.life > 0 && h.y - h.radius <= this.height + 80)
  }

  private updateParticles(): void {
    for (const p of this.particles) {
      p.vy += GRAVITY * 0.6
      p.x += p.vx
      p.y += p.vy
      p.life -= 0.025
    }
    this.particles = this.particles.filter((p) => p.life > 0)
  }

  // ---- slicing ----

  private detectSlices(): void {
    const vel = this.bladeVelocity()
    const blade = this.bladeSegment()
    if (!blade) return

    const threshold = this.tip.long ? LONG_BLADE_THRESHOLD : VELOCITY_THRESHOLD
    if (vel < threshold) return

    const tol = this.tip.long ? 16 : 13
    // Snapshot: sliceFruit() reassigns this.fruits, so iterate a stable copy.
    for (const f of [...this.fruits]) {
      if (f.sliced) continue
      const dist = pointSegmentDistance(f.x, f.y, blade.ax, blade.ay, blade.bx, blade.by)
      if (dist <= f.radius + tol) {
        this.sliceFruit(f)
      }
    }
  }

  /**
   * The active cutting segment.
   * - Normal mode: the short prev→current fingertip motion segment.
   * - Long-blade mode: a long bar centered on the fingertip, oriented
   *   perpendicular to the motion so sweeping it cuts a wide front of fruit.
   */
  private bladeSegment(): { ax: number; ay: number; bx: number; by: number } | null {
    if (!this.tip.detected) return null

    if (!this.tip.long) {
      return { ax: this.tip.prevX, ay: this.tip.prevY, bx: this.tip.x, by: this.tip.y }
    }

    let dx = this.tip.x - this.tip.prevX
    let dy = this.tip.y - this.tip.prevY
    const len = Math.hypot(dx, dy)
    if (len < 0.001) {
      dx = 1
      dy = 0
    } else {
      dx /= len
      dy /= len
    }
    // perpendicular to motion
    const px = -dy
    const py = dx
    return {
      ax: this.tip.x + px * LONG_BLADE_HALF,
      ay: this.tip.y + py * LONG_BLADE_HALF,
      bx: this.tip.x - px * LONG_BLADE_HALF,
      by: this.tip.y - py * LONG_BLADE_HALF,
    }
  }

  private sliceFruit(f: Fruit): void {
    f.sliced = true
    this.score += 10
    this.cb.onScoreChange?.(this.score)
    this.increaseDifficulty()
    gameAudio.playSlice()

    // Slice direction perpendicular spread based on blade motion.
    const angle = Math.atan2(this.tip.y - this.tip.prevY, this.tip.x - this.tip.prevX)
    const px = Math.cos(angle + Math.PI / 2)
    const py = Math.sin(angle + Math.PI / 2)

    for (const top of [true, false]) {
      const sign = top ? 1 : -1
      this.halves.push({
        x: f.x,
        y: f.y,
        vx: f.vx * 0.4 + px * sign * 2.5,
        vy: f.vy * 0.4 + py * sign * 2.5 - 1,
        emoji: f.emoji,
        radius: f.radius,
        rotation: f.rotation,
        rotSpeed: f.rotSpeed + sign * 0.05,
        top,
        life: 1,
      })
    }

    // Juice burst — 12 colored dots.
    const color = JUICE_COLORS[f.emoji] ?? '#ffffff'
    for (let i = 0; i < 12; i++) {
      const a = (Math.PI * 2 * i) / 12 + Math.random() * 0.4
      const speed = 2 + Math.random() * 4
      this.particles.push({
        x: f.x,
        y: f.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        size: 3 + Math.random() * 4,
        color,
        life: 1,
      })
    }

    // Remove the original fruit immediately.
    this.fruits = this.fruits.filter((other) => other !== f)
  }

  private increaseDifficulty(): void {
    // Every 50 pts → faster spawns, clamped.
    const level = Math.floor(this.score / 50)
    this.spawnInterval = Math.max(560, 1100 - level * 80)
  }

  private loseLife(): void {
    this.lives--
    this.cb.onLivesChange?.(this.lives)
    gameAudio.playMiss()
    if (this.lives <= 0) {
      this.running = false
      this.cb.onGameOver?.(this.score)
    }
  }

  // ---- rendering ----

  private render(): void {
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.width, this.height)

    // Translucent dark tint so the mirrored webcam behind shows through dimly
    // while keeping the #0a0a1a theme.
    ctx.fillStyle = 'rgba(10, 10, 26, 0.62)'
    ctx.fillRect(0, 0, this.width, this.height)

    this.drawParticles()
    this.drawFruits()
    this.drawHalves()
    this.drawTrail()
    this.drawVignette()
  }

  private drawFruits(): void {
    const ctx = this.ctx
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '64px serif'
    for (const f of this.fruits) {
      ctx.save()
      ctx.translate(f.x, f.y)
      ctx.rotate(f.rotation)
      ctx.fillText(f.emoji, 0, 0)
      ctx.restore()
    }
  }

  private drawHalves(): void {
    const ctx = this.ctx
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '64px serif'
    for (const h of this.halves) {
      ctx.save()
      ctx.globalAlpha = Math.max(0, Math.min(1, h.life))
      ctx.translate(h.x, h.y)
      ctx.rotate(h.rotation)
      // Clip to top or bottom half so it reads as two pieces.
      ctx.beginPath()
      if (h.top) {
        ctx.rect(-h.radius, -h.radius, h.radius * 2, h.radius)
      } else {
        ctx.rect(-h.radius, 0, h.radius * 2, h.radius)
      }
      ctx.clip()
      ctx.fillText(h.emoji, 0, 0)
      ctx.restore()
    }
  }

  private drawParticles(): void {
    const ctx = this.ctx
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life)
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  // Glow without shadowBlur (which is very expensive): additive 'lighter'
  // compositing with a wide soft pass + a thin bright core pass.
  private drawTrail(): void {
    const ctx = this.ctx
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1]
      const b = this.trail[i]
      const t = b.life / TRAIL_LIFE
      // soft glow
      ctx.strokeStyle = `rgba(120, 190, 255, ${t * 0.32})`
      ctx.lineWidth = 4 + t * 16
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
      // bright core
      ctx.strokeStyle = `rgba(255, 255, 255, ${t * 0.9})`
      ctx.lineWidth = 1 + t * 5
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }

    // Open-hand long blade: a wide bar perpendicular to motion.
    if (this.tip.detected && this.tip.long) {
      const blade = this.bladeSegment()
      if (blade) {
        ctx.strokeStyle = 'rgba(120, 200, 255, 0.4)'
        ctx.lineWidth = 22
        ctx.beginPath()
        ctx.moveTo(blade.ax, blade.ay)
        ctx.lineTo(blade.bx, blade.by)
        ctx.stroke()
        ctx.strokeStyle = 'rgba(220, 245, 255, 0.95)'
        ctx.lineWidth = 6
        ctx.beginPath()
        ctx.moveTo(blade.ax, blade.ay)
        ctx.lineTo(blade.bx, blade.by)
        ctx.stroke()
      }
    }

    // Glowing fingertip dot (two additive circles, no shadowBlur).
    if (this.tip.detected) {
      const r = this.tip.long ? 10 : 7
      ctx.fillStyle = 'rgba(120, 190, 255, 0.5)'
      ctx.beginPath()
      ctx.arc(this.tip.x, this.tip.y, r * 2.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(this.tip.x, this.tip.y, r, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.restore()
  }

  private vignette: CanvasGradient | null = null

  private drawVignette(): void {
    const ctx = this.ctx
    if (!this.vignette) {
      const g = ctx.createRadialGradient(
        this.width / 2,
        this.height / 2,
        this.height * 0.3,
        this.width / 2,
        this.height / 2,
        this.height * 0.75,
      )
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(1, 'rgba(0,0,0,0.55)')
      this.vignette = g
    }
    ctx.fillStyle = this.vignette
    ctx.fillRect(0, 0, this.width, this.height)
  }
}

/** Shortest distance from point (px,py) to segment (ax,ay)-(bx,by). */
function pointSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}
