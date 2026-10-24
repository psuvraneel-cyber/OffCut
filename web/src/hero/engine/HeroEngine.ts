import * as THREE from 'three'
import { FluidSim } from '../fluid/FluidSim'
import { CutGesture } from '../interaction/cutGesture'
import { ImpactEffects } from '../interaction/ImpactEffects'
import { PointerTracker, type PointerSample } from '../interaction/pointer'
import { ParticleRenderer } from '../particles/ParticleRenderer'
import { ParticleSim } from '../particles/ParticleSim'
import { buildShapes, type ShapeSet } from '../particles/shapes'
import { PostChain } from '../post/composer'
import { Backdrop } from '../world/Backdrop'
import { frameShape } from './layout'
import type { GpuSupport, GpuTier } from './quality'
import type { FrameState, HeroSystem } from './types'

const FOV = 35
const CAMERA_Z = 6
// Physics runs at a fixed rate so springs behave the same at 30, 60 or 144 fps.
const STEP = 1 / 60
const MAX_SUBSTEPS = 2

export interface HeroEngineOptions {
  tier: GpuTier
  support: GpuSupport
  reducedMotion: boolean
  getIntro: () => number
  getScroll: () => number
  // Narrow layout only: px from the top of the canvas where the hero text begins.
  getTextTop: () => number
}

// Shapes are built for the tier's particle count before the engine starts.
export async function createHeroEngine(canvas: HTMLCanvasElement, options: HeroEngineOptions) {
  const shapes = await buildShapes(options.tier.simSize ** 2)
  return new HeroEngine(canvas, shapes, options)
}

// One renderer, one canvas and one loop for everything in the hero. Systems do the actual work;
// the engine feeds them a shared FrameState and renders only while the hero is visible.
export class HeroEngine {
  private readonly canvas: HTMLCanvasElement
  private readonly options: HeroEngineOptions
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200)
  private readonly anchor = new THREE.Group()
  private readonly pointer: PointerTracker
  private readonly cutGesture = new CutGesture()
  private readonly systems: HeroSystem[] = []
  private readonly post: PostChain
  private readonly state: FrameState
  private readonly resizeObserver: ResizeObserver
  private readonly visibilityObserver: IntersectionObserver
  // Cursor → shape-space mapping: a ray from the camera through the cursor, hitting the shape's plane.
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointerNdc = new THREE.Vector2()
  private readonly shapePlane = new THREE.Plane()
  private readonly planeNormal = new THREE.Vector3()
  private readonly hit = new THREE.Vector3()
  private readonly tilt = { x: 0, y: 0 }
  private readonly particleCount: number
  private readonly fluidGrid: number
  private shaderError = false
  private onScreen = false
  private running = false
  private frameId = 0
  private lastTime = 0
  private accumulator = 0

  constructor(canvas: HTMLCanvasElement, shapes: ShapeSet, options: HeroEngineOptions) {
    this.canvas = canvas
    this.options = options

    // Throws when WebGL is unavailable; the caller falls back to the lite tier.
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, options.tier.maxPixelRatio))
    this.renderer.setClearColor(0x000000, 0)
    // A shader that fails to compile should send us down a tier, not leave a blank hero.
    this.renderer.debug.onShaderError = (gl, _program, vertex, fragment) => {
      this.shaderError = true
      console.warn('Hero shader failed to compile.', gl.getShaderInfoLog(vertex), gl.getShaderInfoLog(fragment))
    }

    this.pointer = new PointerTracker(canvas)
    this.camera.position.set(0, 0, CAMERA_Z)
    this.camera.updateMatrixWorld()
    this.scene.add(this.anchor)
    this.state = {
      time: 0,
      scroll: options.getScroll(),
      intro: options.getIntro(),
      motion: options.reducedMotion ? 0 : 1,
      tier: options.tier,
      pointer: this.pointer.state,
      pointerLocal: new THREE.Vector3(99, 99, 0),
      pointerInfluence: 0,
      camera: this.camera,
      anchor: this.anchor,
      width: 1,
      height: 1,
      pixelRatio: this.renderer.getPixelRatio(),
      cut: { id: 0, age: Infinity, start: new THREE.Vector2(), end: new THREE.Vector2(), startUv: new THREE.Vector2(), endUv: new THREE.Vector2() },
      shock: { id: 0, age: Infinity, centre: new THREE.Vector3(), centreUv: new THREE.Vector2() },
    }

    try {
      // The fluid only ever moves under a mouse or pen, so touch screens and reduced motion skip it.
      const { tier } = options
      const stirrable = !options.reducedMotion && window.matchMedia('(pointer: fine)').matches
      const fluid = stirrable && tier.fluidGrid > 0 ? new FluidSim(this.renderer, this.scene, tier.fluidGrid, tier.fluidIterations) : null
      const sim = new ParticleSim(this.renderer, shapes, {
        size: tier.simSize,
        textureType: options.support.textureType,
        reducedMotion: options.reducedMotion,
        scroll: this.state.scroll,
        fluid,
      })
      // Order matters: the fluid steps before the particles that sample it.
      this.systems.push(new Backdrop(this.scene))
      if (fluid) this.systems.push(fluid)
      this.systems.push(
        sim,
        new ParticleRenderer(sim, this.anchor, options.reducedMotion, tier.depthOfField),
        new ImpactEffects(this.anchor),
      )
      this.post = new PostChain(this.renderer, this.scene, this.camera, tier, options.reducedMotion)
      this.particleCount = sim.count
      this.fluidGrid = fluid ? tier.fluidGrid : 0
      // Run every shader once (a zero-length step changes nothing) so compile errors surface here.
      for (const system of this.systems) system.step?.(0, this.state)
      this.resize()
      this.frame(0)
      if (this.shaderError) throw new Error('Hero shaders failed to compile')
    } catch (error) {
      this.disposeResources()
      throw error
    }

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(canvas)
    this.visibilityObserver = new IntersectionObserver(([entry]) => {
      this.onScreen = entry.isIntersecting
      this.updateRunning()
    })
    this.visibilityObserver.observe(canvas)
    document.addEventListener('visibilitychange', this.updateRunning)
  }

  // One line for the ?debug overlay.
  describe() {
    const { tier, support } = this.options
    const fluid = this.fluidGrid ? `fluid ${this.fluidGrid}/${tier.fluidIterations}` : 'no fluid'
    return `${tier.name} · ${this.particleCount.toLocaleString()} particles (${tier.simSize}²) · ${fluid} · ${support.textureType} · dpr ${this.state.pixelRatio}`
  }

  dispose() {
    this.stop()
    this.resizeObserver.disconnect()
    this.visibilityObserver.disconnect()
    document.removeEventListener('visibilitychange', this.updateRunning)
    this.disposeResources()
  }

  private disposeResources() {
    for (const system of this.systems) system.dispose()
    this.systems.length = 0
    this.post?.dispose()
    this.pointer.dispose()
    this.renderer.dispose()
  }

  // Render only while the hero is on screen and the tab is visible.
  private readonly updateRunning = () => {
    if (this.onScreen && !document.hidden) this.start()
    else this.stop()
  }

  private start() {
    if (this.running) return
    this.running = true
    this.lastTime = performance.now()
    this.frameId = requestAnimationFrame(this.tick)
  }

  private stop() {
    this.running = false
    cancelAnimationFrame(this.frameId)
  }

  private readonly tick = (now: number) => {
    this.frameId = requestAnimationFrame(this.tick)
    // Clamp long gaps (a dropped frame, a debugger pause) so nothing explodes on resume.
    const dt = Math.min((now - this.lastTime) / 1000, 0.1)
    this.lastTime = now
    this.frame(dt)
  }

  private frame(dt: number) {
    const s = this.state
    s.time += dt
    s.scroll = this.options.getScroll()
    s.intro = this.options.getIntro()
    this.pointer.update(dt)
    this.updateTilt(dt)
    this.updatePointer(dt)
    this.updateGestures(dt)

    // Fixed steps, rounded to the nearest whole step so a 60 Hz display gets exactly one per frame
    // (and 120 Hz one every other frame). Time beyond two steps is dropped: slow motion, not chaos.
    this.accumulator += dt
    let substeps = 0
    while (this.accumulator > STEP / 2 && substeps < MAX_SUBSTEPS) {
      for (const system of this.systems) system.step?.(STEP, s)
      this.accumulator -= STEP
      substeps++
    }
    this.accumulator = Math.min(this.accumulator, STEP / 2)

    for (const system of this.systems) system.update(dt, s)
    this.post.render(dt)
  }

  // Ease towards the pointer for a gentle parallax tilt, plus a slow idle sway.
  private updateTilt(dt: number) {
    const { pointer, motion, time } = this.state
    const ease = 1 - Math.exp(-dt * 3)
    this.tilt.x += (pointer.viewY * 0.18 - this.tilt.x) * ease
    this.tilt.y += (pointer.viewX * 0.3 - this.tilt.y) * ease
    this.anchor.rotation.x = this.tilt.x * motion
    this.anchor.rotation.y = (this.tilt.y + Math.sin(time * 0.25) * 0.12) * motion
  }

  // Fade the cursor's influence in and out, and follow it with a little lag so it feels liquid.
  private updatePointer(dt: number) {
    const s = this.state
    const p = s.pointer
    const active = p.inside && p.fine && s.motion > 0
    s.pointerInfluence += ((active ? 1 : 0) - s.pointerInfluence) * (1 - Math.exp(-dt * 5))
    if (p.inside && this.toShape(p.clientX, p.clientY)) {
      s.pointerLocal.lerp(this.hit, 1 - Math.exp(-dt * 15))
    }
  }

  // Swipes become cuts and clicks become shockwaves (neither with reduced motion).
  private updateGestures(dt: number) {
    const { cut, shock, motion } = this.state
    cut.age += dt
    shock.age += dt
    const tap = this.pointer.taps.pop()
    this.pointer.taps.length = 0
    if (motion === 0) return

    const stroke = this.cutGesture.detect(this.pointer.history)
    if (stroke && this.toShape(stroke.start.x, stroke.start.y)) {
      cut.start.set(this.hit.x, this.hit.y)
      if (this.toShape(stroke.end.x, stroke.end.y)) {
        cut.end.set(this.hit.x, this.hit.y)
        this.toUv(stroke.start, cut.startUv)
        this.toUv(stroke.end, cut.endUv)
        cut.id++
        cut.age = 0
      }
    }
    if (tap && this.toShape(tap.x, tap.y)) {
      shock.centre.set(this.hit.x, this.hit.y, 0)
      this.toUv(tap, shock.centreUv)
      shock.id++
      shock.age = 0
    }
  }

  // Client px → a point on the shape's (tilted) plane, in shape units, left in this.hit.
  private toShape(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect()
    this.pointerNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1))
    this.anchor.updateMatrixWorld()
    this.raycaster.setFromCamera(this.pointerNdc, this.camera)
    this.planeNormal.set(0, 0, 1).applyQuaternion(this.anchor.quaternion)
    this.shapePlane.setFromNormalAndCoplanarPoint(this.planeNormal, this.anchor.position)
    if (!this.raycaster.ray.intersectPlane(this.shapePlane, this.hit)) return false
    this.anchor.worldToLocal(this.hit)
    return true
  }

  // Client px → canvas uv (0..1, +y up), for the fluid.
  private toUv(sample: PointerSample, out: THREE.Vector2) {
    const rect = this.canvas.getBoundingClientRect()
    out.set((sample.x - rect.left) / rect.width, 1 - (sample.y - rect.top) / rect.height)
  }

  private resize() {
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    if (!width || !height) return

    const s = this.state
    this.renderer.setSize(width, height, false)
    this.post?.setSize(width, height)
    s.width = width
    s.height = height
    s.pixelRatio = this.renderer.getPixelRatio()

    // Shift the lens rather than the shape, so the camera keeps looking straight at the shape
    // wherever the layout puts it on screen.
    const visibleHeight = 2 * CAMERA_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    const framing = frameShape(width, height, this.options.getTextTop(), visibleHeight)
    this.anchor.scale.setScalar(framing.scale)
    this.camera.setViewOffset(width, height, (-framing.centreX * width) / 2, (framing.centreY * height) / 2, width, height)

    for (const system of this.systems) system.resize?.(s)
    if (!this.running) this.frame(0)
  }
}
