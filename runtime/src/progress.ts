export function clampProgress(fraction: number): number {
  if (Number.isNaN(fraction)) {
    return 0;
  }

  return Math.min(1, Math.max(0, fraction));
}

export function weightedProgress(completed: number, weight: number, stageFraction: number): number {
  return completed + weight * clampProgress(stageFraction);
}
