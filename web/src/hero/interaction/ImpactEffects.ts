import * as THREE from 'three'
import type { FrameState, HeroSystem } from '../engine/types'
import { sceneColor } from '../post/tone'

// Timing shared with the particle simulation, in seconds and shape units.
export const SHOCK_LIFE = 0.5
export const SHOCK_SPEED = 5
// How far past the stroke's ends a cut still slices.
export const CUT_REACH = 0.9
const SHOCK_RADIUS = SHOCK_SPEED * SHOCK_LIFE

// Hot pink-white core with an orchid glow (tokens.css), as additive light.
const CORE = sceneColor('#fff0fc')
const GLOW = sceneColor('#e08bff')

const vertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

// An expanding ring that matches the shockwave front in the particles.
const ringFragment = /* glsl */ `
uniform float uRadius;
uniform float uFade;
uniform vec3 uCore;
uniform vec3 uGlow;
varying vec2 vUv;

void main() {
  float d = length(vUv * 2.0 - 1.0);
  float ring = exp(-pow((d - uRadius) / 0.02, 2.0));
  float halo = exp(-pow((d - uRadius) / 0.09, 2.0)) * 0.3;
  gl_FragColor = vec4(mix(uGlow, uCore, ring), (ring + halo) * uFade);
}
`

function glowMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uCore: { value: CORE }, uGlow: { value: GLOW }, ...uniforms },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
}

// The visible side of the tap gesture: a glowing ring that matches the shockwave. It lives in the
// shape's space, so it tilts with the particles. (Cuts show only in the particles themselves.)
export class ImpactEffects implements HeroSystem {
  private readonly geometry = new THREE.PlaneGeometry(1, 1)
  private readonly ringMaterial = glowMaterial(ringFragment, { uRadius: { value: 0 }, uFade: { value: 0 } })
  private readonly ring = new THREE.Mesh(this.geometry, this.ringMaterial)

  constructor(parent: THREE.Object3D) {
    this.ring.visible = false
    this.ring.renderOrder = 1
    parent.add(this.ring)
  }

  update(_dt: number, state: FrameState) {
    const { shock } = state
    this.ring.visible = shock.id > 0 && shock.age < SHOCK_LIFE
    if (this.ring.visible) {
      this.ring.position.copy(shock.centre)
      this.ring.scale.setScalar(SHOCK_RADIUS * 2)
      this.ringMaterial.uniforms.uRadius.value = shock.age / SHOCK_LIFE
      this.ringMaterial.uniforms.uFade.value = (1 - shock.age / SHOCK_LIFE) ** 1.5
    }
  }

  dispose() {
    this.ring.removeFromParent()
    this.geometry.dispose()
    this.ringMaterial.dispose()
  }
}
