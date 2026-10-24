import * as THREE from 'three'
import type { FrameState, HeroSystem } from '../engine/types'
import {
  advectShader,
  baseVertex,
  curlShader,
  divergenceShader,
  fadeShader,
  gradientShader,
  pressureShader,
  splatShader,
  underlayFragment,
  underlayVertex,
  vorticityShader,
} from './fluidShaders'

// Tuning, in canvas heights and seconds. Velocity fades slowly so stirring lingers after the
// pointer stops; dye fades a little faster so the glow never builds up.
const VELOCITY_DISSIPATION = 0.7
const DYE_DISSIPATION = 1.4
const PRESSURE_FADE = 0.8
const VORTICITY = 22
// Gaussian splat size (variance-like, in heights²) and how much pointer velocity each splat adds.
const SPLAT_RADIUS = 0.0025
const SPLAT_FORCE = 0.6
const SPLAT_SPACING = 0.02
const DYE_AMOUNT = 0.05
const UNDERLAY_INTENSITY = 0.32
// After this long without input the fluid is cleared and the solver sleeps.
const IDLE_AFTER = 6
// Dye colours: violet and orchid from tokens.css, alternating as the pointer moves.
const DYE_COLORS = [new THREE.Vector3(0.48, 0.3, 1), new THREE.Vector3(0.84, 0.48, 1)]

// A render target pair for fields that read their own previous value.
class PingPong {
  read: THREE.WebGLRenderTarget
  write: THREE.WebGLRenderTarget

  constructor(width: number, height: number) {
    this.read = createTarget(width, height)
    this.write = createTarget(width, height)
  }

  swap() {
    const read = this.read
    this.read = this.write
    this.write = read
  }

  dispose() {
    this.read.dispose()
    this.write.dispose()
  }
}

function createTarget(width: number, height: number) {
  return new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
  })
}

function pass(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    vertexShader: baseVertex,
    fragmentShader,
    uniforms: { uTexel: { value: new THREE.Vector2() }, ...uniforms },
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  })
}

interface Fields {
  width: number
  height: number
  velocity: PingPong
  dye: PingPong
  pressure: PingPong
  divergence: THREE.WebGLRenderTarget
  curl: THREE.WebGLRenderTarget
}

// Our own stable-fluids solver on half-float render targets. The pointer, cuts and taps inject
// velocity; particles sample the velocity field at their screen position so they stir like ink.
export class FluidSim implements HeroSystem {
  private readonly renderer: THREE.WebGLRenderer
  private readonly grid: number
  private readonly iterations: number
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private readonly quad: THREE.Mesh
  private readonly underlay: THREE.Mesh
  private readonly materials = {
    splat: pass(splatShader, { tTarget: { value: null }, uAspect: { value: 1 }, uPoint: { value: new THREE.Vector2() }, uValue: { value: new THREE.Vector3() }, uRadius: { value: SPLAT_RADIUS } }),
    advect: pass(advectShader, { tVelocity: { value: null }, tSource: { value: null }, uAspect: { value: 1 }, uDt: { value: 0 }, uDissipation: { value: 0 } }),
    curl: pass(curlShader, { tVelocity: { value: null }, uCell: { value: 1 } }),
    vorticity: pass(vorticityShader, { tVelocity: { value: null }, tCurl: { value: null }, uCell: { value: 1 }, uStrength: { value: VORTICITY }, uDt: { value: 0 } }),
    divergence: pass(divergenceShader, { tVelocity: { value: null }, uCell: { value: 1 } }),
    fade: pass(fadeShader, { tSource: { value: null }, uFactor: { value: PRESSURE_FADE } }),
    pressure: pass(pressureShader, { tPressure: { value: null }, tDivergence: { value: null }, uCell: { value: 1 } }),
    gradient: pass(gradientShader, { tVelocity: { value: null }, tPressure: { value: null }, uCell: { value: 1 } }),
  }
  private readonly underlayMaterial: THREE.ShaderMaterial
  private fields: Fields | null = null
  private aspect = 1
  private lastPointer: THREE.Vector2 | null = null
  private lastInput = -Infinity
  private sleeping = true
  private handledCut = 0
  private handledShock = 0
  private dyeIndex = 0

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, grid: number, iterations: number) {
    this.renderer = renderer
    this.grid = grid
    this.iterations = iterations
    const plane = new THREE.PlaneGeometry(2, 2)
    this.quad = new THREE.Mesh(plane, this.materials.splat)
    this.quad.frustumCulled = false
    this.scene.add(this.quad)

    // Additive colour without touching the canvas alpha, so the page behind still shows through.
    this.underlayMaterial = new THREE.ShaderMaterial({
      vertexShader: underlayVertex,
      fragmentShader: underlayFragment,
      uniforms: { tDye: { value: null }, uIntensity: { value: UNDERLAY_INTENSITY } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    })
    this.underlay = new THREE.Mesh(plane, this.underlayMaterial)
    this.underlay.frustumCulled = false
    this.underlay.renderOrder = -1
    this.underlay.visible = false
    scene.add(this.underlay)
  }

  // Fluid velocity in canvas heights per second (xy), sampled by the particles.
  get velocityTexture(): THREE.Texture | null {
    return this.fields?.velocity.read.texture ?? null
  }

  resize(state: FrameState) {
    const aspect = state.width / state.height
    // The grid size applies to the shorter side; cells stay square.
    const height = Math.round(aspect >= 1 ? this.grid : this.grid / aspect)
    const width = Math.round(height * aspect)
    if (this.fields && this.fields.width === width && this.fields.height === height) return

    this.disposeFields()
    this.aspect = aspect
    this.fields = {
      width,
      height,
      velocity: new PingPong(width, height),
      dye: new PingPong(width, height),
      pressure: new PingPong(width, height),
      divergence: createTarget(width, height),
      curl: createTarget(width, height),
    }
    const texel = new THREE.Vector2(1 / width, 1 / height)
    for (const material of Object.values(this.materials)) {
      material.uniforms.uTexel.value.copy(texel)
      if (material.uniforms.uCell) material.uniforms.uCell.value = 1 / height
      if (material.uniforms.uAspect) material.uniforms.uAspect.value = aspect
    }
    this.sleeping = true
    this.clearFields()
  }

  step(dt: number, state: FrameState) {
    const fields = this.fields
    if (!fields) return
    const autoClear = this.renderer.autoClear
    this.renderer.autoClear = false

    this.injectPointer(state)
    this.injectCut(state)
    this.injectShock(state)

    if (!this.sleeping && state.time - this.lastInput > IDLE_AFTER) {
      this.clearFields()
      this.sleeping = true
    }
    if (!this.sleeping) this.solve(dt, fields)

    this.renderer.setRenderTarget(null)
    this.renderer.autoClear = autoClear
  }

  update() {
    this.underlay.visible = !this.sleeping
    this.underlayMaterial.uniforms.tDye.value = this.fields?.dye.read.texture ?? null
  }

  dispose() {
    this.disposeFields()
    for (const material of Object.values(this.materials)) material.dispose()
    this.underlayMaterial.dispose()
    this.quad.geometry.dispose()
    this.underlay.removeFromParent()
  }

  private disposeFields() {
    if (!this.fields) return
    const { velocity, dye, pressure, divergence, curl } = this.fields
    velocity.dispose()
    dye.dispose()
    pressure.dispose()
    divergence.dispose()
    curl.dispose()
    this.fields = null
  }

  private clearFields() {
    if (!this.fields) return
    const { velocity, dye, pressure } = this.fields
    const clearColor = this.renderer.getClearColor(new THREE.Color())
    const clearAlpha = this.renderer.getClearAlpha()
    this.renderer.setClearColor(0x000000, 0)
    for (const target of [velocity.read, velocity.write, dye.read, dye.write, pressure.read, pressure.write]) {
      this.renderer.setRenderTarget(target)
      this.renderer.clear(true, false, false)
    }
    this.renderer.setRenderTarget(null)
    this.renderer.setClearColor(clearColor, clearAlpha)
  }

  private run(material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget) {
    this.quad.material = material
    this.renderer.setRenderTarget(target)
    this.renderer.render(this.scene, this.camera)
  }

  private solve(dt: number, f: Fields) {
    const m = this.materials

    m.curl.uniforms.tVelocity.value = f.velocity.read.texture
    this.run(m.curl, f.curl)

    m.vorticity.uniforms.tVelocity.value = f.velocity.read.texture
    m.vorticity.uniforms.tCurl.value = f.curl.texture
    m.vorticity.uniforms.uDt.value = dt
    this.run(m.vorticity, f.velocity.write)
    f.velocity.swap()

    m.divergence.uniforms.tVelocity.value = f.velocity.read.texture
    this.run(m.divergence, f.divergence)

    m.fade.uniforms.tSource.value = f.pressure.read.texture
    this.run(m.fade, f.pressure.write)
    f.pressure.swap()

    m.pressure.uniforms.tDivergence.value = f.divergence.texture
    for (let i = 0; i < this.iterations; i++) {
      m.pressure.uniforms.tPressure.value = f.pressure.read.texture
      this.run(m.pressure, f.pressure.write)
      f.pressure.swap()
    }

    m.gradient.uniforms.tVelocity.value = f.velocity.read.texture
    m.gradient.uniforms.tPressure.value = f.pressure.read.texture
    this.run(m.gradient, f.velocity.write)
    f.velocity.swap()

    m.advect.uniforms.uDt.value = dt
    m.advect.uniforms.tVelocity.value = f.velocity.read.texture
    m.advect.uniforms.tSource.value = f.velocity.read.texture
    m.advect.uniforms.uDissipation.value = VELOCITY_DISSIPATION
    this.run(m.advect, f.velocity.write)
    f.velocity.swap()

    m.advect.uniforms.tVelocity.value = f.velocity.read.texture
    m.advect.uniforms.tSource.value = f.dye.read.texture
    m.advect.uniforms.uDissipation.value = DYE_DISSIPATION
    this.run(m.advect, f.dye.write)
    f.dye.swap()
  }

  // Adds velocity (canvas heights per second) and dye at a point in canvas uv.
  private splat(x: number, y: number, vx: number, vy: number, dye: THREE.Vector3, radius = SPLAT_RADIUS) {
    const f = this.fields
    if (!f) return
    const u = this.materials.splat.uniforms
    u.uPoint.value.set(x, y)
    u.uRadius.value = radius

    u.tTarget.value = f.velocity.read.texture
    u.uValue.value.set(vx, vy, 0)
    this.run(this.materials.splat, f.velocity.write)
    f.velocity.swap()

    u.tTarget.value = f.dye.read.texture
    u.uValue.value.copy(dye)
    this.run(this.materials.splat, f.dye.write)
    f.dye.swap()

    this.sleeping = false
  }

  // The pointer drags the fluid along its path, in evenly spaced splats so fast moves stay smooth.
  private injectPointer(state: FrameState) {
    const p = state.pointer
    if (!p.inside || !p.fine) {
      this.lastPointer = null
      return
    }
    const x = p.ndcX * 0.5 + 0.5
    const y = p.ndcY * 0.5 + 0.5
    // px per ms → canvas heights per second, with +y up.
    const vx = ((p.vx * 1000) / state.height) * SPLAT_FORCE
    const vy = ((-p.vy * 1000) / state.height) * SPLAT_FORCE
    const last = this.lastPointer ?? new THREE.Vector2(x, y)
    const distance = Math.hypot((x - last.x) * this.aspect, y - last.y)
    if (Math.hypot(vx, vy) > 0.02 && distance > 1e-4) {
      const speed = Math.min(Math.hypot(vx, vy), 3)
      const dye = DYE_COLORS[this.dyeIndex++ % 2].clone().multiplyScalar(DYE_AMOUNT * speed)
      const count = Math.min(Math.ceil(distance / SPLAT_SPACING), 8)
      for (let i = 1; i <= count; i++) {
        const t = i / count
        this.splat(last.x + (x - last.x) * t, last.y + (y - last.y) * t, vx / count, vy / count, dye)
      }
      this.lastInput = state.time
    }
    this.lastPointer = last.set(x, y)
  }

  // A cut sweeps a sheet of fluid along the stroke (velocity only: no dye, so no glowing line).
  private injectCut(state: FrameState) {
    const cut = state.cut
    if (cut.id === this.handledCut) return
    this.handledCut = cut.id
    const dx = (cut.endUv.x - cut.startUv.x) * this.aspect
    const dy = cut.endUv.y - cut.startUv.y
    const length = Math.hypot(dx, dy) || 1
    const dye = new THREE.Vector3()
    for (let i = 0; i <= 8; i++) {
      const t = i / 8
      const x = cut.startUv.x + (cut.endUv.x - cut.startUv.x) * t
      const y = cut.startUv.y + (cut.endUv.y - cut.startUv.y) * t
      this.splat(x, y, (dx / length) * 1.2, (dy / length) * 1.2, dye, SPLAT_RADIUS * 0.6)
    }
    this.lastInput = state.time
  }

  // A tap pushes a puff of fluid outwards from the point.
  private injectShock(state: FrameState) {
    const shock = state.shock
    if (shock.id === this.handledShock) return
    this.handledShock = shock.id
    const dye = DYE_COLORS[1].clone().multiplyScalar(DYE_AMOUNT * 2)
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2
      const ox = Math.cos(angle) * 0.03
      const oy = Math.sin(angle) * 0.03
      this.splat(shock.centreUv.x + ox / this.aspect, shock.centreUv.y + oy, Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, dye)
    }
    this.lastInput = state.time
  }
}
