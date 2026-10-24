import * as THREE from 'three'
import type { FrameState, HeroSystem } from '../engine/types'
import { sceneColor } from '../post/tone'
import { INTRO } from './intro'

// Near-dark until the burst, then the world fades up behind the particles.
const VEIL_DARKNESS = 0.92
const SPARK_SIZE = 0.9

const veilVertex = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
}
`

const veilFragment = /* glsl */ `
uniform float uAlpha;

void main() {
  gl_FragColor = vec4(0.0, 0.0, 0.0, uAlpha);
}
`

const sparkVertex = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv * 2.0 - 1.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// A hot point with a soft halo and four faint rays: the single spark the shape is born from.
const sparkFragment = /* glsl */ `
uniform float uBrightness;
uniform vec3 uCore;
uniform vec3 uGlow;
varying vec2 vUv;

void main() {
  float d = length(vUv);
  float core = exp(-d * d * 400.0);
  float halo = exp(-d * 9.0) * 0.5;
  float rays = (exp(-abs(vUv.x) * 60.0) + exp(-abs(vUv.y) * 60.0)) * exp(-d * 4.0) * 0.35;
  gl_FragColor = vec4(mix(uGlow, uCore, core), (core * 3.0 + halo + rays) * uBrightness);
}
`

// The intro's own visuals. The particles' part (burst, rise, gather) lives in the simulation.
export class IntroEffects implements HeroSystem {
  private readonly geometry = new THREE.PlaneGeometry(1, 1)
  private readonly veilMaterial = new THREE.ShaderMaterial({
    vertexShader: veilVertex,
    fragmentShader: veilFragment,
    uniforms: { uAlpha: { value: 0 } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  private readonly sparkMaterial = new THREE.ShaderMaterial({
    vertexShader: sparkVertex,
    fragmentShader: sparkFragment,
    uniforms: { uBrightness: { value: 0 }, uCore: { value: sceneColor('#fff4fe') }, uGlow: { value: sceneColor('#e08bff') } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  private readonly veil = new THREE.Mesh(this.geometry, this.veilMaterial)
  private readonly spark = new THREE.Mesh(this.geometry, this.sparkMaterial)

  constructor(scene: THREE.Scene, anchor: THREE.Object3D) {
    // After the world (mountains are -6…-4) but before the dye glow and the particles.
    this.veil.renderOrder = -3
    this.veil.frustumCulled = false
    this.spark.renderOrder = 1
    scene.add(this.veil)
    anchor.add(this.spark)
  }

  update(_dt: number, state: FrameState) {
    const intro = state.intro
    const reveal = THREE.MathUtils.smoothstep(intro, 0.08, 0.6)
    this.veil.visible = reveal < 1
    this.veilMaterial.uniforms.uAlpha.value = VEIL_DARKNESS * (1 - reveal)

    // Fades in, flares as it bursts, and is gone a moment later.
    const glow = THREE.MathUtils.smoothstep(intro, 0, 0.08) * (1 - THREE.MathUtils.smoothstep(intro, INTRO.burst, INTRO.burst + 0.07))
    const flare = 1 + 1.6 * THREE.MathUtils.smoothstep(intro, INTRO.burst - 0.04, INTRO.burst)
    this.spark.visible = glow > 0.001
    this.spark.scale.setScalar(SPARK_SIZE * flare * (0.85 + 0.15 * Math.sin(state.time * 9)))
    this.sparkMaterial.uniforms.uBrightness.value = glow * flare
  }

  dispose() {
    this.veil.removeFromParent()
    this.spark.removeFromParent()
    this.geometry.dispose()
    this.veilMaterial.dispose()
    this.sparkMaterial.dispose()
  }
}
