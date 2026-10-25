import * as THREE from 'three'
import { GPUComputationRenderer, type Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js'
import type { FrameState, HeroSystem } from '../engine/types'
import { INTRO } from '../choreography/intro'
import type { FluidSim } from '../fluid/FluidSim'
import { GROUND_Y } from '../world/Horizon'
import { SHOCK_LIFE } from '../interaction/ImpactEffects'
import { toTexels, type ShapeSet } from './shapes'
import { positionShader, velocityShader } from './simShaders'

// Spring and noise tuning, in shape units and seconds. The lively spring is under-damped
// (ratio ≈ 0.55), so morphs overshoot a little and settle in about 0.8 s. Reduced motion swaps in
// a stiff, critically damped spring with no noise: shapes still change, but settle fast and calmly.
// The resting drift is kept tiny: smooth noise bends whole edges together, so anything more makes
// settled shapes look wobbly instead of crisp (v1 only had a slight shimmer at rest).
const LIVELY = { stiffness: 80, damping: 9.5, curlStrength: 40, drift: 0.06 }
const CALM = { stiffness: 260, damping: 32, curlStrength: 0, drift: 0 }
const CURL_SCALE = 1.3
const MAX_SPEED = 6
const CLOUD_SCALE = 0.6
// Peak push at the cursor (an acceleration), and how far it reaches. Only used without a fluid.
const POINTER_PUSH = 22
const POINTER_RADIUS = 0.5
// How quickly particles take on the fluid's velocity (per second), and a cut's kick (units/s).
const FLUID_DRAG = 7
const CUT_KICK = 4.4

export interface ParticleSimOptions {
  size: number
  textureType: 'float' | 'half'
  reducedMotion: boolean
  // Reduced motion, and a rebuild after the watchdog steps down, start on the current shape.
  scroll: number
  startOnShape: boolean
  // Medium and high tiers stir the particles with a fluid instead of a direct pointer force.
  fluid: FluidSim | null
  // World → shape space, to place the particles that lie on the timeline floor before the intro.
  worldToShape: THREE.Matrix4
}

// Intro starting points: a share in a tiny spark at the centre, the rest scattered over the
// timeline floor in front of and behind the shape (spread in world units).
function introOrigins(shapes: ShapeSet, worldToShape: THREE.Matrix4): Float32Array {
  const out = new Float32Array(shapes.count * 3)
  const point = new THREE.Vector3()
  for (let i = 0; i < shapes.count; i++) {
    const rnd = shapes.random[i]
    // Cheap per-particle hashes, so the scatter doesn't line up with the colour random.
    const a = (rnd * 7919.17) % 1
    const b = (rnd * 104729.3) % 1
    if (rnd < INTRO.sparkShare) {
      point.set(a - 0.5, b - 0.5, ((rnd * 31.7) % 1) - 0.5).multiplyScalar(0.06)
    } else {
      point.set((a - 0.5) * 14, GROUND_Y, 2 - b * 16).applyMatrix4(worldToShape)
    }
    point.toArray(out, i * 3)
  }
  return out
}

// Position and velocity live in float textures and are integrated on the GPU, one texel per particle.
export class ParticleSim implements HeroSystem {
  readonly size: number
  private readonly gpgpu: GPUComputationRenderer
  private readonly positionVariable: Variable
  private readonly velocityVariable: Variable
  // Spring targets: dust cloud (intro), frame, phone, captions, laptop, then the intro origins.
  private readonly targets: THREE.DataTexture[]
  private readonly velocityUniforms: Record<string, THREE.IUniform>
  private readonly positionUniforms: Record<string, THREE.IUniform>
  private readonly fluid: FluidSim | null
  private readonly anchorPosition = new THREE.Vector3()
  private readonly cutDirection = new THREE.Vector2()
  private handledCut = 0

  constructor(renderer: THREE.WebGLRenderer, shapes: ShapeSet, options: ParticleSimOptions) {
    const { size } = options
    this.size = size
    this.fluid = options.fluid
    this.gpgpu = new GPUComputationRenderer(size, size, renderer)
    this.gpgpu.setDataType(options.textureType === 'float' ? THREE.FloatType : THREE.HalfFloatType)

    const texture = (points: Float32Array) => {
      const data = new THREE.DataTexture(toTexels(points, shapes.random), size, size, THREE.RGBAFormat, THREE.FloatType)
      data.needsUpdate = true
      return data
    }
    const origins = introOrigins(shapes, options.worldToShape)
    // v1's dust cloud is sized for 9k particles; this many would swamp the screen, so draw it in.
    const cloud = shapes.cloud.map((v) => v * CLOUD_SCALE)
    const order = [cloud, shapes.frame, shapes.phone, shapes.captions, shapes.laptop, origins]
    this.targets = order.map(texture)

    // No intro to play (reduced motion, or rebuilt mid-session): start on the current shape.
    const startShape = options.startOnShape ? order[1 + Math.round(THREE.MathUtils.clamp(options.scroll, 0, 3))] : origins
    this.positionVariable = this.gpgpu.addVariable('texturePosition', positionShader, texture(startShape))
    this.velocityVariable = this.gpgpu.addVariable('textureVelocity', velocityShader, this.gpgpu.createTexture())
    this.gpgpu.setVariableDependencies(this.positionVariable, [this.positionVariable, this.velocityVariable])
    this.gpgpu.setVariableDependencies(this.velocityVariable, [this.positionVariable, this.velocityVariable])

    const physics = options.reducedMotion ? CALM : LIVELY
    this.velocityUniforms = this.velocityVariable.material.uniforms
    Object.assign(this.velocityUniforms, {
      uDt: { value: 0 },
      uTime: { value: 0 },
      uMotion: { value: options.reducedMotion ? 0 : 1 },
      uMorph: { value: 0 },
      uIntro: { value: 0 },
      tCloud: { value: this.targets[0] },
      tOrigin: { value: this.targets[5] },
      tFrom: { value: this.targets[1] },
      tTo: { value: this.targets[2] },
      uStiffness: { value: physics.stiffness },
      uDamping: { value: physics.damping },
      uCurlScale: { value: CURL_SCALE },
      uCurlStrength: { value: physics.curlStrength },
      uDrift: { value: physics.drift },
      uMaxSpeed: { value: MAX_SPEED },
      uPointer: { value: new THREE.Vector3(99, 99, 0) },
      uPointerStrength: { value: 0 },
      uPointerRadius: { value: POINTER_RADIUS },
      uCutLine: { value: new THREE.Vector4() },
      uCut: { value: new THREE.Vector2() },
      uShock: { value: new THREE.Vector4(0, 0, 0, -1) },
      tFluid: { value: null },
      uLocalToClip: { value: new THREE.Matrix4() },
      uFluidToLocal: { value: 1 },
      uFluidStrength: { value: FLUID_DRAG },
    })
    if (this.fluid) this.velocityVariable.material.defines.FLUID = ''
    this.positionUniforms = this.positionVariable.material.uniforms
    this.positionUniforms.uDt = { value: 0 }

    const error = this.gpgpu.init()
    if (error) {
      this.dispose()
      throw new Error(error)
    }
  }

  get count() {
    return this.size * this.size
  }

  get positionTexture(): THREE.Texture {
    return this.gpgpu.getCurrentRenderTarget(this.positionVariable).texture
  }

  get velocityTexture(): THREE.Texture {
    return this.gpgpu.getCurrentRenderTarget(this.velocityVariable).texture
  }

  step(dt: number, state: FrameState) {
    const u = this.velocityUniforms
    // Which pair of shapes the scroll position sits between, and how far along.
    const scroll = THREE.MathUtils.clamp(state.scroll, 0, 3)
    const segment = Math.min(Math.floor(scroll), 2)
    u.tFrom.value = this.targets[segment + 1]
    u.tTo.value = this.targets[segment + 2]
    u.uMorph.value = scroll - segment
    u.uIntro.value = state.intro
    u.uTime.value = state.time
    u.uDt.value = dt
    u.uPointer.value.copy(state.pointerLocal)
    u.uPointerStrength.value = this.fluid ? 0 : POINTER_PUSH * state.pointerInfluence
    this.updateFluid(state)
    this.updateImpacts(state)
    this.positionUniforms.uDt.value = dt
    this.gpgpu.compute()
  }

  private updateFluid(state: FrameState) {
    if (!this.fluid) return
    const u = this.velocityUniforms
    const { camera, anchor } = state
    u.tFluid.value = this.fluid.velocityTexture
    u.uLocalToClip.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).multiply(anchor.matrixWorld)
    // World units per canvas height at the shape's distance, divided by the shape's scale.
    anchor.getWorldPosition(this.anchorPosition)
    const distance = camera.position.distanceTo(this.anchorPosition)
    const visibleHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    u.uFluidToLocal.value = visibleHeight / anchor.scale.y
  }

  // A cut lands on exactly one step; the shockwave runs for its whole life.
  private updateImpacts(state: FrameState) {
    const u = this.velocityUniforms
    const { cut, shock } = state
    if (cut.id !== this.handledCut) {
      this.handledCut = cut.id
      const direction = this.cutDirection.subVectors(cut.end, cut.start)
      const halfLength = direction.length() / 2
      direction.normalize()
      u.uCutLine.value.set((cut.start.x + cut.end.x) / 2, (cut.start.y + cut.end.y) / 2, direction.x, direction.y)
      u.uCut.value.set(halfLength, CUT_KICK)
    } else {
      u.uCut.value.y = 0
    }
    const age = shock.id > 0 && shock.age < SHOCK_LIFE ? shock.age : -1
    u.uShock.value.set(shock.centre.x, shock.centre.y, shock.centre.z, age)
  }

  update() {}

  dispose() {
    this.gpgpu.dispose()
    for (const target of this.targets) target.dispose()
  }
}
