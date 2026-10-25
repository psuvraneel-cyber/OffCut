// Quality tiers for the hero. The GPU tiers run the full engine, "lite" is the v1 particle field and
// "static" is the CSS gradient. Detection picks a starting tier and ?tier= can force one.
// No Three.js imports here: this module ships in the main chunk so the choice is made before the
// heavy code loads.

export type TierName = 'high' | 'medium' | 'low' | 'lite' | 'static'
export type GpuTierName = 'high' | 'medium' | 'low'

export interface GpuTier {
  name: GpuTierName
  // Edge of the particle textures: simSize² particles.
  simSize: number
  // Fluid grid edge in cells, and pressure iterations; 0 means no fluid (direct pointer force).
  fluidGrid: number
  fluidIterations: number
  bloom: 'half' | 'quarter' | 'none'
  depthOfField: boolean
  grain: boolean
  vignette: boolean
  chromaticAberration: boolean
  // The timeline-horizon world: how many waveform mountain ranges, and whether the sky has aurora.
  mountainLayers: number
  aurora: boolean
  maxPixelRatio: number
}

export const GPU_TIERS: Record<GpuTierName, GpuTier> = {
  high: {
    name: 'high',
    simSize: 384,
    fluidGrid: 256,
    fluidIterations: 25,
    bloom: 'half',
    depthOfField: true,
    grain: true,
    vignette: true,
    chromaticAberration: true,
    mountainLayers: 3,
    aurora: true,
    maxPixelRatio: 1.75,
  },
  medium: {
    name: 'medium',
    simSize: 256,
    fluidGrid: 128,
    fluidIterations: 18,
    bloom: 'half',
    depthOfField: false,
    grain: true,
    vignette: true,
    chromaticAberration: false,
    mountainLayers: 3,
    aurora: true,
    maxPixelRatio: 1.5,
  },
  low: {
    name: 'low',
    simSize: 128,
    fluidGrid: 0,
    fluidIterations: 0,
    bloom: 'quarter',
    depthOfField: false,
    grain: false,
    vignette: true,
    chromaticAberration: false,
    mountainLayers: 1,
    aurora: false,
    maxPixelRatio: 1.25,
  },
}

// Best first. The engine only ever steps down this list during a session.
export const TIER_ORDER: readonly TierName[] = ['high', 'medium', 'low', 'lite', 'static']

export function isGpuTier(tier: TierName): tier is GpuTierName {
  return tier === 'high' || tier === 'medium' || tier === 'low'
}

// The next tier down (static is the floor).
export function lowerTier(tier: TierName): TierName {
  return TIER_ORDER[Math.min(TIER_ORDER.indexOf(tier) + 1, TIER_ORDER.length - 1)]
}

// Once the watchdog steps down, later page loads in the same session start there too, so the
// hero never flickers back up to a tier that already proved too slow. Storage may be blocked.
const CAP_KEY = 'offcut:tier-cap'

export function capTier(tier: TierName): TierName {
  try {
    const cap = TIER_ORDER.find((name) => name === window.sessionStorage.getItem(CAP_KEY))
    return cap && TIER_ORDER.indexOf(cap) > TIER_ORDER.indexOf(tier) ? cap : tier
  } catch {
    return tier
  }
}

export function rememberTierCap(tier: TierName) {
  try {
    window.sessionStorage.setItem(CAP_KEY, tier)
  } catch {
    // Not remembered: the next load just detects again.
  }
}

// Averages frame costs (engine/frameTimer.ts) over a window of frames and reports when they run long.
const SLOW_FRAME_MS = 20
const WINDOW_FRAMES = 60

export class FrameWatchdog {
  private total = 0
  private count = 0

  // True once a full window has averaged slower than SLOW_FRAME_MS; then it starts a new window.
  sample(frameMs: number): boolean {
    if (frameMs <= 0) return false
    this.total += frameMs
    this.count++
    if (this.count < WINDOW_FRAMES) return false
    const slow = this.total / this.count > SLOW_FRAME_MS
    this.total = 0
    this.count = 0
    return slow
  }
}

export interface HeroFlags {
  // ?tier=high|medium|low|lite|static
  tier: TierName | null
  // ?debug shows the overlay; ?debug=slow also fakes a slow GPU (extra simulation work every
  // frame) so the watchdog can be seen stepping down.
  debug: boolean
  slow: boolean
}

export function readFlags(search = window.location.search): HeroFlags {
  const params = new URLSearchParams(search)
  const tier = TIER_ORDER.find((name) => name === params.get('tier')) ?? null
  const debug = params.get('debug')
  return { tier, debug: debug !== null, slow: debug === 'slow' }
}

export interface GpuSupport {
  // What the simulation can render into: 32-bit floats, or 16-bit when that's all there is.
  textureType: 'float' | 'half'
  maxTextureSize: number
  // Unmasked GPU name when the browser shares it, otherwise ''.
  gpu: string
}

// Can this context render into a float texture of the given type? Some drivers advertise the
// extension but still refuse, so actually try it.
function canRenderTo(gl: WebGL2RenderingContext, internalFormat: number, type: number) {
  const texture = gl.createTexture()
  const framebuffer = gl.createFramebuffer()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, gl.RGBA, type, null)
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.deleteFramebuffer(framebuffer)
  gl.deleteTexture(texture)
  return ok
}

// Probe WebGL2 on a throwaway canvas, so the real canvas stays free for whichever tier wins.
// Returns null when the GPU tiers can't run (no WebGL2, software rendering, no float targets).
export function probeGpu(): GpuSupport | null {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true })
    if (!gl) return null

    let textureType: GpuSupport['textureType'] | null = null
    if (gl.getExtension('EXT_color_buffer_float') && canRenderTo(gl, gl.RGBA32F, gl.FLOAT)) {
      textureType = 'float'
    } else if (
      (gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float')) &&
      canRenderTo(gl, gl.RGBA16F, gl.HALF_FLOAT)
    ) {
      textureType = 'half'
    }
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const support: GpuSupport = {
      textureType: textureType ?? 'half',
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      gpu: info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '',
    }
    // Particles read the simulation from the vertex shader.
    const vertexTextures = gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) as number
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return textureType && vertexTextures >= 4 ? support : null
  } catch {
    return null
  }
}

// Phones, tablets and small screens start low; desktops start on medium, or high when the
// hardware clearly has headroom. The runtime watchdog steps down from there if frames run long.
export function detectTier(support: GpuSupport | null): TierName {
  if (!support) return 'lite'
  const coarse = window.matchMedia('(pointer: coarse)').matches
  // Some embedded and emulated browsers report a 0×0 screen; fall back to the window then.
  const shortSide = Math.min(window.screen.width, window.screen.height) || Math.min(window.innerWidth, window.innerHeight)
  const small = shortSide < 720
  const cores = navigator.hardwareConcurrency ?? 4
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  if (coarse || small || cores <= 4 || memory <= 4) return 'low'

  const discrete = /nvidia|geforce|quadro|radeon (rx|pro)|apple m\d (pro|max|ultra)/i.test(support.gpu)
  return discrete && support.textureType === 'float' && cores >= 8 ? 'high' : 'medium'
}
