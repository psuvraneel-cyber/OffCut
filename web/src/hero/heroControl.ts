// Lets the rest of the site stop the hero's rendering, e.g. so the clipping tool can have the GPU
// to itself, and start it again later. Plain window events, so callers needn't load the hero or
// Three.js. Pausing stops the render loop on every tier (resources stay allocated for a quick resume).
export const HERO_PAUSE = 'offcut:hero-pause'
export const HERO_RESUME = 'offcut:hero-resume'

export function pauseHero() {
  window.dispatchEvent(new Event(HERO_PAUSE))
}

export function resumeHero() {
  window.dispatchEvent(new Event(HERO_RESUME))
}
