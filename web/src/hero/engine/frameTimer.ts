// How long our own work takes each frame, for the watchdog. The gap between animation frames isn't
// enough: browsers cap it (Chrome's Energy Saver runs pages at 30 fps on battery), which would look
// like a slow GPU and step the hero down for nothing. Where the browser offers GPU timer queries
// (Chrome, Edge) we time the GPU work directly; elsewhere we fall back to the frame gap.

interface TimerExtension {
  TIME_ELAPSED_EXT: number
  GPU_DISJOINT_EXT: number
}

// Queries resolve a few frames late; never keep more than this many waiting.
const MAX_PENDING = 6
// Without timer queries, a gap this long isn't GPU load (a background tab, a throttled preview, a
// debugger pause), so it isn't counted.
const IGNORE_GAP_ABOVE = 250

export class FrameTimer {
  private readonly gl: WebGL2RenderingContext
  private readonly ext: TimerExtension | null
  private readonly pending: WebGLQuery[] = []
  private active: WebGLQuery | null = null
  private cpuStart = 0
  private cpuMs = 0

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    this.ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExtension | null
  }

  // True when frame costs come from the GPU timer rather than the frame gap.
  get measuresGpu() {
    return this.ext !== null
  }

  begin() {
    this.cpuStart = performance.now()
    if (!this.ext || this.pending.length >= MAX_PENDING) return
    this.active = this.gl.createQuery()
    if (this.active) this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, this.active)
  }

  end() {
    this.cpuMs = performance.now() - this.cpuStart
    if (!this.ext || !this.active) return
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT)
    this.pending.push(this.active)
    this.active = null
  }

  // Costs (ms) of frames whose GPU timings have arrived since the last call: GPU time, or this
  // frame's CPU time if that was longer. Without the extension, the frame gap stands in.
  collect(frameGapMs: number): number[] {
    if (!this.ext) return frameGapMs > IGNORE_GAP_ABOVE ? [] : [frameGapMs]
    const costs: number[] = []
    // A disjoint event (power state change, context switch) spoils every query in flight.
    const disjoint = this.gl.getParameter(this.ext.GPU_DISJOINT_EXT) as boolean
    while (this.pending.length > 0) {
      const query = this.pending[0]
      if (!this.gl.getQueryParameter(query, this.gl.QUERY_RESULT_AVAILABLE)) break
      const gpuMs = (this.gl.getQueryParameter(query, this.gl.QUERY_RESULT) as number) / 1e6
      this.gl.deleteQuery(query)
      this.pending.shift()
      if (!disjoint) costs.push(Math.max(gpuMs, this.cpuMs))
    }
    return costs
  }

  dispose() {
    for (const query of this.pending) this.gl.deleteQuery(query)
    this.pending.length = 0
    if (this.active) this.gl.deleteQuery(this.active)
  }
}
