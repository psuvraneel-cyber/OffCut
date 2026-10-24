// One set of pointer listeners for every hero system: the parallax tilt, the particle forces and,
// later, the fluid and the cut gesture all read the same state.

export interface PointerState {
  clientX: number
  clientY: number
  // Relative to the canvas, -1..1 with +y up (like WebGL).
  ndcX: number
  ndcY: number
  // Relative to the window, -1..1 with +y up, for the parallax tilt.
  viewX: number
  viewY: number
  // Smoothed velocity in CSS px per ms; it decays to zero once the pointer stops.
  vx: number
  vy: number
  inside: boolean
  // Mouse or pen. Touch never stirs, cuts or gets the custom cursor, because swipes are for scrolling.
  fine: boolean
}

// Events further apart than this don't count as one continuous movement.
const MAX_GAP_MS = 100

export class PointerTracker {
  readonly state: PointerState = {
    clientX: 0,
    clientY: 0,
    ndcX: 0,
    ndcY: 0,
    viewX: 0,
    viewY: 0,
    vx: 0,
    vy: 0,
    inside: false,
    fine: window.matchMedia('(pointer: fine)').matches,
  }
  private readonly target: HTMLElement
  private lastEvent = 0

  constructor(target: HTMLElement) {
    this.target = target
    window.addEventListener('pointermove', this.onPointerMove, { passive: true })
    window.addEventListener('pointerup', this.onPointerUp, { passive: true })
    window.addEventListener('pointercancel', this.onPointerUp, { passive: true })
    document.documentElement.addEventListener('pointerleave', this.onPointerLeave)
  }

  dispose() {
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerUp)
    document.documentElement.removeEventListener('pointerleave', this.onPointerLeave)
  }

  // Once per frame: let the velocity fade when no events arrive (the pointer has stopped).
  update(dt: number) {
    if (performance.now() - this.lastEvent > 40) {
      const decay = Math.exp(-dt * 20)
      this.state.vx *= decay
      this.state.vy *= decay
    }
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    const s = this.state
    const gap = event.timeStamp - this.lastEvent
    if (this.lastEvent > 0 && gap > 0 && gap < MAX_GAP_MS) {
      // Exponential smoothing evens out uneven event timing without adding much lag.
      s.vx += ((event.clientX - s.clientX) / gap - s.vx) * 0.5
      s.vy += ((event.clientY - s.clientY) / gap - s.vy) * 0.5
    } else {
      s.vx = 0
      s.vy = 0
    }
    this.lastEvent = event.timeStamp

    const rect = this.target.getBoundingClientRect()
    s.clientX = event.clientX
    s.clientY = event.clientY
    s.ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1
    s.ndcY = -(((event.clientY - rect.top) / rect.height) * 2 - 1)
    s.viewX = (event.clientX / window.innerWidth) * 2 - 1
    s.viewY = -((event.clientY / window.innerHeight) * 2 - 1)
    s.inside = Math.abs(s.ndcX) <= 1 && Math.abs(s.ndcY) <= 1
    s.fine = event.pointerType !== 'touch'
  }

  // A finger lifting off the screen shouldn't leave the pointer "inside" forever.
  private readonly onPointerUp = (event: PointerEvent) => {
    if (event.pointerType === 'touch') this.state.inside = false
  }

  private readonly onPointerLeave = () => {
    this.state.inside = false
  }
}
