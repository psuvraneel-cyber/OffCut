// A soft glow that follows the cursor, shedding sparks that drift up and fade. Used inside the
// hero on the lite tier, and site-wide on a fixed canvas (components/PointerEffects.tsx).
// Plain 2D canvas; it only animates while there is something to draw.

const COLORS = ['155, 123, 255', '224, 139, 255', '111, 227, 255'] // violet, orchid, signal
const MAX_SPARKS = 360
const SPACING = 7 // px between sparks along the cursor's path
const HALO_RADIUS = 150

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  decay: number
  size: number
  sprite: HTMLCanvasElement
}

// Pre-render one soft dot per colour; drawing images is much cheaper than gradients per spark.
function makeSprite(rgb: string) {
  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = 32
  const ctx = sprite.getContext('2d')
  if (ctx) {
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16)
    gradient.addColorStop(0, `rgba(${rgb}, 1)`)
    gradient.addColorStop(0.35, `rgba(${rgb}, 0.6)`)
    gradient.addColorStop(1, `rgba(${rgb}, 0)`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 32, 32)
  }
  return sprite
}

export class CursorTrail {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly sprites: HTMLCanvasElement[]
  private readonly resizeObserver: ResizeObserver
  // Areas that draw their own pointer effects; the trail steps aside there.
  private readonly exclude: string | null
  private readonly sparks: Spark[] = []
  private readonly halo = { x: 0, y: 0, alpha: 0 }
  private readonly cursor = { x: 0, y: 0, inside: false }
  private last: { x: number; y: number } | null = null
  private width = 0
  private height = 0
  private dpr = 1
  private frameId = 0
  private lastTime = 0
  private running = false

  constructor(canvas: HTMLCanvasElement, exclude: string | null = null) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas unavailable')
    this.canvas = canvas
    this.exclude = exclude
    this.ctx = ctx
    this.sprites = COLORS.map(makeSprite)

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    window.addEventListener('pointermove', this.onPointerMove, { passive: true })
    document.documentElement.addEventListener('pointerleave', this.onPointerLeave)
    this.resize()
  }

  dispose() {
    this.running = false
    cancelAnimationFrame(this.frameId)
    this.resizeObserver.disconnect()
    window.removeEventListener('pointermove', this.onPointerMove)
    document.documentElement.removeEventListener('pointerleave', this.onPointerLeave)
  }

  private resize() {
    this.dpr = Math.min(window.devicePixelRatio, 1.5)
    this.width = this.canvas.clientWidth
    this.height = this.canvas.clientHeight
    this.canvas.width = Math.round(this.width * this.dpr)
    this.canvas.height = Math.round(this.height * this.dpr)
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return

    const rect = this.canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    const excluded = this.exclude !== null && event.target instanceof Element && event.target.closest(this.exclude) !== null
    const inside = !excluded && x >= 0 && y >= 0 && x <= rect.width && y <= rect.height
    this.cursor.inside = inside
    if (!inside) {
      this.last = null
      return
    }

    this.cursor.x = x
    this.cursor.y = y
    if (!this.last) {
      this.halo.x = x
      this.halo.y = y
      this.spawn(x, y)
    } else {
      // Fill the gap between pointer events so fast flicks leave a continuous trail.
      const dx = x - this.last.x
      const dy = y - this.last.y
      const steps = Math.min(Math.floor(Math.hypot(dx, dy) / SPACING), 12)
      for (let i = 1; i <= steps; i++) this.spawn(this.last.x + (dx * i) / steps, this.last.y + (dy * i) / steps)
    }
    this.last = { x, y }
    this.start()
  }

  private readonly onPointerLeave = () => {
    this.cursor.inside = false
    this.last = null
  }

  private spawn(x: number, y: number) {
    if (this.sparks.length >= MAX_SPARKS) this.sparks.shift()
    const pick = Math.random()
    this.sparks.push({
      x: x + (Math.random() - 0.5) * 4,
      y: y + (Math.random() - 0.5) * 4,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6 - 0.35,
      life: 1,
      decay: 0.8 + Math.random() * 0.6,
      size: 4 + Math.random() * 8,
      sprite: this.sprites[pick < 0.1 ? 2 : pick < 0.55 ? 0 : 1],
    })
  }

  private start() {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now()
    this.frameId = requestAnimationFrame(this.tick)
  }

  private readonly tick = (now: number) => {
    const dt = Math.min((now - this.lastTime) / 1000, 0.05)
    this.lastTime = now
    const { ctx } = this

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.width, this.height)
    ctx.globalCompositeOperation = 'lighter'

    // The glow lags a little behind the cursor and fades out when it leaves.
    this.halo.alpha += ((this.cursor.inside ? 1 : 0) - this.halo.alpha) * 0.08
    this.halo.x += (this.cursor.x - this.halo.x) * 0.12
    this.halo.y += (this.cursor.y - this.halo.y) * 0.12
    if (this.halo.alpha > 0.01) {
      const { x, y, alpha } = this.halo
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, HALO_RADIUS)
      gradient.addColorStop(0, `rgba(${COLORS[1]}, ${0.18 * alpha})`)
      gradient.addColorStop(0.5, `rgba(${COLORS[0]}, ${0.08 * alpha})`)
      gradient.addColorStop(1, `rgba(${COLORS[0]}, 0)`)
      ctx.fillStyle = gradient
      ctx.fillRect(x - HALO_RADIUS, y - HALO_RADIUS, HALO_RADIUS * 2, HALO_RADIUS * 2)
    }

    // Move, fade and draw sparks, compacting the array in place as they die.
    let alive = 0
    for (const spark of this.sparks) {
      spark.life -= spark.decay * dt
      if (spark.life <= 0) continue
      spark.x += spark.vx * 60 * dt
      spark.y += spark.vy * 60 * dt
      spark.vx *= 0.96
      spark.vy *= 0.97
      const size = spark.size * (0.4 + 0.6 * spark.life)
      ctx.globalAlpha = spark.life * spark.life
      ctx.drawImage(spark.sprite, spark.x - size / 2, spark.y - size / 2, size, size)
      this.sparks[alive++] = spark
    }
    this.sparks.length = alive
    ctx.globalAlpha = 1

    if (alive > 0 || this.halo.alpha > 0.01 || this.cursor.inside) {
      this.frameId = requestAnimationFrame(this.tick)
    } else {
      ctx.clearRect(0, 0, this.width, this.height)
      this.running = false
    }
  }
}
