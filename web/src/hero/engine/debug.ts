// The ?debug overlay: frame rate, frame time and whatever the active tier reports about itself.
// It measures with its own requestAnimationFrame loop, so it works for every tier, even static.
export class DebugOverlay {
  private readonly element = document.createElement('div')
  private info = ''
  private frames = 0
  private windowStart = performance.now()
  private frameId = 0

  constructor() {
    this.element.className = 'hero-debug mono'
    this.element.setAttribute('aria-hidden', 'true')
    document.body.append(this.element)
    this.frameId = requestAnimationFrame(this.tick)
  }

  set(info: string) {
    this.info = info
  }

  dispose() {
    cancelAnimationFrame(this.frameId)
    this.element.remove()
  }

  private readonly tick = (now: number) => {
    this.frames++
    const elapsed = now - this.windowStart
    if (elapsed >= 500) {
      const fps = (this.frames * 1000) / elapsed
      this.element.textContent = `${fps.toFixed(0)} fps · ${(elapsed / this.frames).toFixed(1)} ms · ${this.info}`
      this.frames = 0
      this.windowStart = now
    }
    this.frameId = requestAnimationFrame(this.tick)
  }
}
