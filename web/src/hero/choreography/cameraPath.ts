// Scroll-linked camera keyframes, in the same units as Hero.tsx's timeline (one unit per step), so
// the camera lands on a clean composition exactly where the scroll snaps (whole numbers).
// The camera always orbits and looks at the shape; the layout's lens shift keeps the shape where
// the layout wants it on screen.

export interface CameraPose {
  // Multiple of the resting camera distance.
  distance: number
  // Orbit angle around the shape (radians, + swings right).
  yaw: number
  // Which way the shape faces (radians). At the snap points it matches the yaw (mod 2π), so the
  // shape faces the camera; in between it can stay put while the camera swings round it.
  facing: number
  // How far (NDC) the horizon rises behind the shape. Narrow layouts scale this down.
  lift: number
  // Scale of the shape relative to its framed scale. When the camera pulls back at a snap point
  // this grows with the distance, so the shape keeps (about) its framed size on screen.
  size: number
}

interface Key extends CameraPose {
  at: number
}

const TAU = Math.PI * 2

const KEYS: Key[] = [
  // 1: the long video, framed.
  { at: 0, distance: 1, yaw: 0, facing: 0, lift: 0, size: 1 },
  // Dolly right up to the play button…
  { at: 0.4, distance: 0.17, yaw: 0.1, facing: 0, lift: 0, size: 1 },
  // …through it, swinging round behind the shape as it folds…
  { at: 0.62, distance: 0.32, yaw: Math.PI, facing: 0, lift: 0, size: 1 },
  // 2: …and out in front again as the phone forms.
  { at: 1, distance: 1, yaw: TAU, facing: 0, lift: 0, size: 1 },
  // 3: drift sideways while the phone dissolves into captions, which turn to face us.
  { at: 2, distance: 1.04, yaw: TAU + 0.38, facing: 0.38, lift: 0, size: 1.04 },
  // 4: pull back to reveal the laptop (a little smaller on screen) with the horizon risen behind it.
  { at: 3, distance: 1.6, yaw: TAU + 0.22, facing: 0.22, lift: 0.24, size: 1.34 },
]

const FIELDS = ['distance', 'yaw', 'facing', 'lift', 'size'] as const

// Cubic Hermite through the keys with Catmull-Rom tangents (scaled for uneven key spacing), so the
// camera moves smoothly through the in-between keys instead of stopping at each one.
function tangent(i: number, field: (typeof FIELDS)[number]) {
  const before = KEYS[Math.max(i - 1, 0)]
  const after = KEYS[Math.min(i + 1, KEYS.length - 1)]
  return (after[field] - before[field]) / (after.at - before.at)
}

export function sampleCameraPath(scroll: number, out: CameraPose): CameraPose {
  const s = Math.min(Math.max(scroll, 0), KEYS[KEYS.length - 1].at)
  let i = 0
  while (i < KEYS.length - 2 && s > KEYS[i + 1].at) i++
  const a = KEYS[i]
  const b = KEYS[i + 1]
  const span = b.at - a.at
  const t = (s - a.at) / span
  const t2 = t * t
  const t3 = t2 * t
  for (const field of FIELDS) {
    out[field] =
      (2 * t3 - 3 * t2 + 1) * a[field] +
      (t3 - 2 * t2 + t) * span * tangent(i, field) +
      (-2 * t3 + 3 * t2) * b[field] +
      (t3 - t2) * span * tangent(i + 1, field)
  }
  // Never let the overshoot of the curve put the camera inside the shape's centre.
  out.distance = Math.max(out.distance, 0.12)
  return out
}

// Where the camera rests when motion is reduced: no flights, just the framed shot.
export const RESTING_POSE: CameraPose = { distance: 1, yaw: 0, facing: 0, lift: 0, size: 1 }
