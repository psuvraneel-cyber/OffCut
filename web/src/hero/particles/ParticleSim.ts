import * as THREE from 'three'
import { GPUComputationRenderer, type Variable } from 'three/examples/jsm/misc/GPUComputationRenderer.js'
import type { FrameState, HeroSystem } from '../engine/types'
import { toTexels, type ShapeSet } from './shapes'
import { positionShader, velocityShader } from './simShaders'

// Spring and noise tuning, in shape units and seconds. The lively spring is under-damped
// (ratio ≈ 0.55), so morphs overshoot a little and settle in about 0.8 s. Reduced motion swaps in
// a stiff, critically damped spring with no noise: shapes still change, but settle fast and calmly.
const LIVELY = { stiffness: 80, damping: 9.5, curlStrength: 40, drift: 0.5 }
const CALM = { stiffness: 260, damping: 32, curlStrength: 0, drift: 0 }
const CURL_SCALE = 1.3
const MAX_SPEED = 6
// Peak push at the cursor (an acceleration), and how far it reaches.
const POINTER_PUSH = 22
const POINTER_RADIUS = 0.5

export interface ParticleSimOptions {
  size: number
  textureType: 'float' | 'half'
  reducedMotion: boolean
  // Reduced motion starts on the current shape rather than the dust cloud.
  scroll: number
}

// Position and velocity live in float textures and are integrated on the GPU, one texel per particle.
export class ParticleSim implements HeroSystem {
  readonly size: number
  private readonly gpgpu: GPUComputationRenderer
  private readonly positionVariable: Variable
  private readonly velocityVariable: Variable
  // Spring targets in morph order: dust cloud (intro), frame, phone, captions, laptop.
  private readonly targets: THREE.DataTexture[]
  private readonly velocityUniforms: Record<string, THREE.IUniform>
  private readonly positionUniforms: Record<string, THREE.IUniform>

  constructor(renderer: THREE.WebGLRenderer, shapes: ShapeSet, options: ParticleSimOptions) {
    const { size } = options
    this.size = size
    this.gpgpu = new GPUComputationRenderer(size, size, renderer)
    this.gpgpu.setDataType(options.textureType === 'float' ? THREE.FloatType : THREE.HalfFloatType)

    const texture = (points: Float32Array) => {
      const data = new THREE.DataTexture(toTexels(points, shapes.random), size, size, THREE.RGBAFormat, THREE.FloatType)
      data.needsUpdate = true
      return data
    }
    const order = [shapes.cloud, shapes.frame, shapes.phone, shapes.captions, shapes.laptop]
    this.targets = order.map(texture)

    const startShape = options.reducedMotion ? order[1 + Math.round(THREE.MathUtils.clamp(options.scroll, 0, 3))] : shapes.cloud
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
    })
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
    u.uPointerStrength.value = POINTER_PUSH * state.pointerInfluence
    this.positionUniforms.uDt.value = dt
    this.gpgpu.compute()
  }

  update() {}

  dispose() {
    this.gpgpu.dispose()
    for (const target of this.targets) target.dispose()
  }
}
