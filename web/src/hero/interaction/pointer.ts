// One set of pointer listeners for every hero system: the parallax tilt, the fluid, the cut gesture
// and the tap shockwave all read the same state.

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

export interface PointerSample {
  // Client px, and the event's timestamp in ms (same clock as performance.now()).
  x: number
  y: number
  t: number
}

// Events further apart than this don't count as one continuous movement.
const MAX_GAP_MS = 100
// How much mouse/pen movement history to keep for gestures.
const HISTORY_MS = 300
// Clicks on these keep their normal meaning and never trigger a shockwave.
const INTERACTIVE = 'a, button, input, select, textarea, label, [role="button"]'
// A press that travels further than this before release was a drag (maybe a cut), not a tap.
const TAP_SLOP = 10

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
  // Recent mouse/pen positions over the canvas, oldest first. Touch never lands here.
  readonly history: PointerSample[] = []
  // Finger taps on the canvas since the systems last looked, in client px (mouse clicks don't count).
  readonly taps: PointerSample[] = []
  private readonly target: HTMLElement
  private readonly pressedAt = { x: 0, y: 0, touch: false }
  private lastEvent = 0

  constructor(target: HTMLElement) {
    this.target = target
    window.addEventListener('pointermove', this.onPointerMove, { passive: true })
    window.addEventListener('pointerdown', this.onPointerDown, { passive: true })
    window.addEventListener('pointerup', this.onPointerUp, { passive: true })
    window.addEventListener('pointercancel', this.onPointerUp, { passive: true })
    window.addEventListener('click', this.onClick, { passive: true })
    document.documentElement.addEventListener('pointerleave', this.onPointerLeave)
  }

  dispose() {
    window.removeEventListener('pointermove', this.onPointerMove)
    window.removeEventListener('pointerdown', this.onPointerDown)
    window.removeEventListener('pointerup', this.onPointerUp)
    window.removeEventListener('pointercancel', this.onPointerUp)
    window.removeEventListener('click', this.onClick)
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

    if (s.inside && s.fine) {
      this.history.push({ x: event.clientX, y: event.clientY, t: event.timeStamp })
      while (this.history.length > 0 && event.timeStamp - this.history[0].t > HISTORY_MS) this.history.shift()
    } else {
      this.history.length = 0
    }
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    this.pressedAt.x = event.clientX
    this.pressedAt.y = event.clientY
    this.pressedAt.touch = event.pointerType === 'touch'
  }

  // Click rather than pointerdown, so a swipe that scrolls the page never counts as a tap.
  // Only touch taps make a shockwave; mouse and pen clicks keep the hero calm.
  private readonly onClick = (event: MouseEvent) => {
    if (!this.pressedAt.touch) return
    if (event.target instanceof Element && event.target.closest(INTERACTIVE)) return
    if (Math.hypot(event.clientX - this.pressedAt.x, event.clientY - this.pressedAt.y) > TAP_SLOP) return
    const rect = this.target.getBoundingClientRect()
    const inside =
      event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
    if (inside) this.taps.push({ x: event.clientX, y: event.clientY, t: event.timeStamp })
  }

  // A finger lifting off the screen shouldn't leave the pointer "inside" forever.
  private readonly onPointerUp = (event: PointerEvent) => {
    if (event.pointerType === 'touch') this.state.inside = false
  }

  private readonly onPointerLeave = () => {
    this.state.inside = false
    this.history.length = 0
  }
}
