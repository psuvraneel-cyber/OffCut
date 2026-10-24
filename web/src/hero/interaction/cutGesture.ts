import type { PointerSample } from './pointer'

// A stroke counts as a cut when it covers more than CUT_DISTANCE px in under CUT_WINDOW ms, faster
// than CUT_SPEED px/ms, with at most one cut per COOLDOWN ms. The pointer history only holds mouse
// and pen samples: on touch screens swipes are for scrolling.
const CUT_WINDOW = 250
const CUT_DISTANCE = 120
const CUT_SPEED = 1.2
const COOLDOWN = 600

export interface Stroke {
  start: PointerSample
  end: PointerSample
}

export class CutGesture {
  private lastCut = -Infinity

  // The stroke that makes a cut, if the recent history has one. Samples from before the last cut
  // are ignored, so one flick never cuts twice.
  detect(history: readonly PointerSample[]): Stroke | null {
    const end = history[history.length - 1]
    if (!end || end.t - this.lastCut < COOLDOWN) return null

    // Oldest first, so the longest qualifying stroke wins.
    for (const start of history) {
      const elapsed = end.t - start.t
      if (start.t <= this.lastCut || elapsed <= 0 || elapsed > CUT_WINDOW) continue
      const distance = Math.hypot(end.x - start.x, end.y - start.y)
      if (distance > CUT_DISTANCE && distance / elapsed > CUT_SPEED) {
        this.lastCut = end.t
        return { start, end }
      }
    }
    return null
  }
}
