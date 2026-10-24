// Point clouds for each particle shape. Every shape has the same number of points, so the
// shader can morph particle i of one shape into particle i of the next.
// Units are Three.js world units; shapes are roughly 2.5 units wide, centred on the origin.

export interface ShapeSet {
  count: number
  cloud: Float32Array
  frame: Float32Array
  phone: Float32Array
  captions: Float32Array
  laptop: Float32Array
  random: Float32Array
  scale: Float32Array
}

type Rand = () => number
type Point = [x: number, y: number]
type Sampler = (rand: Rand) => Point
type Part = [weight: number, sampler: Sampler]

// Seeded random numbers (mulberry32), so the shapes look the same on every visit.
function seeded(seed: number): Rand {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const spread = (rand: Rand, half: number) => (rand() * 2 - 1) * half

// Signed distance to a rounded rectangle centred on the origin: negative inside, positive outside.
function roundRectDistance(x: number, y: number, hw: number, hh: number, r: number) {
  const qx = Math.abs(x) - hw + r
  const qy = Math.abs(y) - hh + r
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r
}

function roundRectEdge(cx: number, cy: number, hw: number, hh: number, r: number, thickness: number): Sampler {
  return (rand) => {
    for (;;) {
      const x = spread(rand, hw + thickness)
      const y = spread(rand, hh + thickness)
      if (Math.abs(roundRectDistance(x, y, hw, hh, r)) < thickness) return [cx + x, cy + y]
    }
  }
}

function roundRectFill(cx: number, cy: number, hw: number, hh: number, r: number): Sampler {
  return (rand) => {
    for (;;) {
      const x = spread(rand, hw)
      const y = spread(rand, hh)
      if (roundRectDistance(x, y, hw, hh, r) < 0) return [cx + x, cy + y]
    }
  }
}

function circleEdge(cx: number, cy: number, radius: number, thickness: number, from = 0, to = Math.PI * 2): Sampler {
  return (rand) => {
    const angle = from + rand() * (to - from)
    const distance = radius + spread(rand, thickness)
    return [cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance]
  }
}

function circleFill(cx: number, cy: number, radius: number): Sampler {
  return (rand) => {
    const angle = rand() * Math.PI * 2
    const distance = radius * Math.sqrt(rand())
    return [cx + Math.cos(angle) * distance, cy + Math.sin(angle) * distance]
  }
}

function lineSegment(x1: number, y1: number, x2: number, y2: number, thickness: number): Sampler {
  return (rand) => {
    const t = rand()
    return [x1 + (x2 - x1) * t + spread(rand, thickness), y1 + (y2 - y1) * t + spread(rand, thickness)]
  }
}

function triangleFill(a: Point, b: Point, c: Point): Sampler {
  return (rand) => {
    let u = rand()
    let v = rand()
    if (u + v > 1) {
      u = 1 - u
      v = 1 - v
    }
    return [a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v, a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v]
  }
}

function oneOf(...samplers: Sampler[]): Sampler {
  return (rand) => samplers[Math.floor(rand() * samplers.length)](rand)
}

// Fill `count` points from weighted parts, with a little depth so the shape reads as 3D when it tilts.
function compose(count: number, rand: Rand, parts: Part[], depth = 0.06): Float32Array {
  const total = parts.reduce((sum, [weight]) => sum + weight, 0)
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    let pick = rand() * total
    let sampler = parts[parts.length - 1][1]
    for (const [weight, candidate] of parts) {
      if (pick < weight) {
        sampler = candidate
        break
      }
      pick -= weight
    }
    const [x, y] = sampler(rand)
    out[i * 3] = x
    out[i * 3 + 1] = y
    out[i * 3 + 2] = spread(rand, depth)
  }
  return out
}

// Loose, flattened sphere of dust the particles start from.
function cloud(count: number, rand: Rand): Float32Array {
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const theta = rand() * Math.PI * 2
    const phi = Math.acos(rand() * 2 - 1)
    const radius = 2.2 + rand() * 1.8
    out[i * 3] = radius * Math.sin(phi) * Math.cos(theta)
    out[i * 3 + 1] = radius * Math.cos(phi) * 0.6
    out[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta) * 0.5
  }
  return out
}

// A wide 16:9 video with a play button and a timeline: the long video going in.
function frame(count: number, rand: Rand) {
  return compose(count, rand, [
    [0.42, roundRectEdge(0, 0.08, 1.25, 0.7, 0.08, 0.025)],
    [0.22, roundRectFill(0, 0.08, 1.2, 0.65, 0.06)],
    [0.14, triangleFill([-0.16, 0.33], [-0.16, -0.17], [0.26, 0.08])],
    [0.12, lineSegment(-1.25, -0.82, 1.25, -0.82, 0.012)],
    [0.04, circleFill(-0.35, -0.82, 0.05)],
  ])
}

// A tall phone showing a Reel: story bars, a person, and a caption bar.
function phone(count: number, rand: Rand) {
  return compose(count, rand, [
    [0.4, roundRectEdge(0, 0, 0.55, 1, 0.17, 0.025)],
    [0.12, roundRectFill(0, 0, 0.5, 0.95, 0.14)],
    [0.1, circleEdge(0, 0.34, 0.16, 0.02)],
    [0.08, circleEdge(0, -0.05, 0.32, 0.02, 0, Math.PI)],
    [0.14, roundRectFill(0, -0.5, 0.36, 0.075, 0.05)],
    [
      0.06,
      oneOf(
        lineSegment(-0.45, 0.88, -0.17, 0.88, 0.008),
        lineSegment(-0.13, 0.88, 0.13, 0.88, 0.008),
        lineSegment(0.17, 0.88, 0.45, 0.88, 0.008),
      ),
    ],
  ])
}

// A laptop with a padlock on screen: nothing leaves your device.
function laptop(count: number, rand: Rand) {
  return compose(count, rand, [
    [0.32, roundRectEdge(0, 0.3, 1, 0.62, 0.06, 0.025)],
    [0.08, roundRectFill(0, 0.3, 0.95, 0.57, 0.05)],
    [0.14, roundRectFill(0, 0.2, 0.2, 0.15, 0.04)],
    [0.08, circleEdge(0, 0.35, 0.13, 0.03, 0, Math.PI)],
    [
      0.22,
      (r) => {
        // Keyboard deck: a trapezoid that widens towards the viewer.
        const t = r()
        return [spread(r, 1.05 + t * 0.25), -0.36 - t * 0.12]
      },
    ],
    [0.06, lineSegment(-1, -0.33, 1, -0.33, 0.01)],
  ])
}

// Rasterise a word on a hidden canvas and pick points from its filled pixels.
async function textPoints(text: string, count: number, width: number, rand: Rand): Promise<Float32Array | null> {
  try {
    await document.fonts.load('800 200px "Inter Variable"')
  } catch {
    // Fall back to whatever sans-serif the system has.
  }

  const canvas = document.createElement('canvas')
  canvas.width = 1400
  canvas.height = 320
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  ctx.font = '800 200px "Inter Variable", system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#fff'
  ctx.fillText(text, canvas.width / 2, canvas.height / 2)

  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  const hits: number[] = []
  for (let y = 0; y < canvas.height; y += 2) {
    for (let x = 0; x < canvas.width; x += 2) {
      if (pixels[(y * canvas.width + x) * 4 + 3] > 128) hits.push(x, y)
    }
  }
  if (hits.length === 0) return null

  const scale = width / ctx.measureText(text).width
  const out = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const j = Math.floor(rand() * (hits.length / 2)) * 2
    out[i * 3] = (hits[j] - canvas.width / 2 + spread(rand, 1)) * scale
    out[i * 3 + 1] = -(hits[j + 1] - canvas.height / 2 + spread(rand, 1)) * scale
    out[i * 3 + 2] = spread(rand, 0.04)
  }
  return out
}

export async function buildShapes(count: number): Promise<ShapeSet> {
  const rand = seeded(20261024)
  const random = new Float32Array(count)
  const scale = new Float32Array(count)
  for (let i = 0; i < count; i++) {
    random[i] = rand()
    scale[i] = 0.5 + rand() ** 2 * 1.4
  }

  const captions =
    (await textPoints('captions', count, 2.5, rand)) ??
    compose(count, rand, [[1, roundRectFill(0, 0, 1.4, 0.3, 0.1)]])

  return {
    count,
    cloud: cloud(count, rand),
    frame: frame(count, rand),
    phone: phone(count, rand),
    captions,
    laptop: laptop(count, rand),
    random,
    scale,
  }
}
