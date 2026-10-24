// Intro timing, shared by Hero.tsx (which plays it) and the engine (which draws it). No Three.js
// here: this ships in the main chunk.
//
// Progress runs 0 → 1 over the intro:
//   0    – 0.12  near-dark; one spark glows where the shape will form
//   0.12        the spark bursts outwards into the dust cloud
//   0.2  – 0.5   particles lying on the timeline floor rise into the cloud
//   0.4  – 0.75  everything gathers into the wide frame (and settles by the end)
//   0.72        the text fades in
export const INTRO = {
  full: 2.8,
  short: 1.3,
  burst: 0.12,
  textAt: 0.72,
  // Share of particles that start in the spark; the rest start on the timeline floor.
  sparkShare: 0.35,
} as const

const PLAYED_KEY = 'offcut:intro-played'

// The full intro plays once per browser session; after that it's shortened. Storage can be
// blocked (private mode, strict settings), so failures just mean "play it in full".
export function introPlayedThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(PLAYED_KEY) === '1'
  } catch {
    return false
  }
}

export function markIntroPlayed() {
  try {
    window.sessionStorage.setItem(PLAYED_KEY, '1')
  } catch {
    // Nothing to do: next time it plays in full again.
  }
}
