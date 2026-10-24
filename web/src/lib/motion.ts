// Reduced motion comes from the OS setting, or from ?motion=reduce so it can be tested without changing it.
export function prefersReducedMotion(): boolean {
  if (new URLSearchParams(window.location.search).get('motion') === 'reduce') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
