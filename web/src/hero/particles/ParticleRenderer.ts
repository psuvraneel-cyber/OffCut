import * as THREE from 'three'
import { WIDE_LAYOUT_MIN } from '../engine/layout'
import { INTRO } from '../choreography/intro'
import type { FrameState, HeroSystem } from '../engine/types'
import { sceneColor } from '../post/tone'
import type { ParticleSim } from './ParticleSim'

// Mirrors the CSS tokens, lightened a touch so the particles glow on the night background.
const PALETTE = { a: '#9b7bff', b: '#e08bff', c: '#6fe3ff', hot: '#ffd1fa' }
// v1 drew 9k particles at 28 (22 on narrow screens); denser tiers draw smaller, dimmer particles
// so the shapes keep roughly the same overall brightness.
const BASE_COUNT = 9000
const particleSize = (width: number, count: number) =>
  (width < WIDE_LAYOUT_MIN ? 22 : 28) * (BASE_COUNT / count) ** 0.3
// Seconds of motion a streak shows behind a fast particle.
const STREAK_SECONDS = 0.03


const vertexShader = /* glsl */ `
uniform sampler2D tPosition;
uniform sampler2D tVelocity;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uSize;
uniform float uAlpha;
uniform float uTime;
uniform float uMotion;
uniform float uStreak;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform vec3 uColorHot;
// Depth of field (high tier): particles nearer than the focus distance swell and dim.
uniform float uFocus;
uniform float uDepthOfField;
uniform float uIntro;

// Quad position in particle radii: x runs along the particle's motion, the tail trails behind.
varying vec2 vLocal;
varying float vTail;
varying vec3 vColor;
varying float vAlpha;

void main() {
  // One instance per simulation texel.
  ivec2 texel = ivec2(gl_InstanceID % SIM_SIZE, gl_InstanceID / SIM_SIZE);
  vec4 data = texelFetch(tPosition, texel, 0);
  vec3 velocity = texelFetch(tVelocity, texel, 0).xyz;
  float rnd = data.w;
  float scale = 0.5 + pow(fract(rnd * 91.37), 2.0) * 1.4;

  vec4 mvPosition = modelViewMatrix * vec4(data.xyz, 1.0);
  // The camera flies right up to (and round) the shape: drop particles that would sit on the lens.
  float depth = -mvPosition.z;
  if (depth < 0.25) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 clip = projectionMatrix * mvPosition;
  // Where the particle was a moment ago, on screen: fast particles stretch along that line.
  vec4 clipBefore = projectionMatrix * (modelViewMatrix * vec4(data.xyz - velocity * uStreak, 1.0));
  vec2 trail = (clip.xy / clip.w - clipBefore.xy / clipBefore.w) * 0.5 * uResolution;
  float trailLength = length(trail);

  // Size attenuation as in v1 (gl_PointSize was this diameter), with a floor against flicker.
  float radius = max(0.5 * uSize * scale * uPixelRatio / -mvPosition.z, 0.75 * uPixelRatio);
  float blur = uDepthOfField * clamp((uFocus + mvPosition.z) * 1.2, 0.0, 3.0);
  // Capped, so a particle passing the lens can't flood the screen.
  radius = min(radius * (1.0 + blur), 36.0 * uPixelRatio);
  // Only genuinely fast particles streak; slow drifters stay round so the shapes read as dust.
  float speed = length(velocity);
  float tail = min(trailLength, radius * 5.0) / radius * smoothstep(2.0, 4.5, speed) * uMotion;
  vec2 axis = trailLength > 1e-3 ? trail / trailLength : vec2(1.0, 0.0);
  vec2 normal = vec2(-axis.y, axis.x);

  vec2 local = vec2(position.x < 0.0 ? -1.0 - tail : 1.0, position.y);
  vec2 offset = (axis * local.x + normal * local.y) * radius;
  clip.xy += offset / (0.5 * uResolution) * clip.w;
  gl_Position = clip;
  vLocal = local;
  vTail = tail;

  // Palette by per-particle random, running hot pink-white as the particle speeds up.
  float heat = smoothstep(0.8, 4.5, speed);
  vec3 color = mix(uColorA, uColorB, smoothstep(0.15, 0.85, rnd));
  color = mix(color, uColorC, step(0.94, rnd));
  vColor = mix(color, uColorHot, heat * 0.85);

  float twinkle = 0.55 + 0.45 * (0.5 + 0.5 * sin(uTime * 2.0 + rnd * 40.0));
  // A streak spreads its light along its length, but fast particles still read brighter.
  vAlpha = uAlpha * mix(1.0, twinkle, uMotion) * (1.0 + heat * 0.8) / (1.0 + tail * 0.3) / ((1.0 + blur) * (1.0 + blur));
  vAlpha *= smoothstep(0.3, 1.0, depth);
  // Intro: the spark's particles stay hidden inside it until the burst; the floor's glitter faintly
  // in the dark and brighten as they rise.
  vAlpha *= rnd < SPARK_SHARE
    ? smoothstep(INTRO_BURST - 0.01, INTRO_BURST + 0.03, uIntro)
    : mix(0.15, 1.0, smoothstep(0.12, 0.35, uIntro));
}
`

const fragmentShader = /* glsl */ `
varying vec2 vLocal;
varying float vTail;
varying vec3 vColor;
varying float vAlpha;

void main() {
  // Soft glow around a short spine (a capsule from -tail to 0), brightest at the head.
  float along = vLocal.x - clamp(vLocal.x, -vTail, 0.0);
  float glow = smoothstep(1.0, 0.0, length(vec2(along, vLocal.y)));
  glow *= glow;
  float fade = mix(1.0, 0.3, clamp(-vLocal.x / max(vTail, 1e-3), 0.0, 1.0));
  gl_FragColor = vec4(vColor, glow * vAlpha * fade);
}
`

// Draws one instanced quad per particle straight from the simulation textures. Quads rather than
// points so fast particles can stretch into streaks (points can only be square).
export class ParticleRenderer implements HeroSystem {
  private readonly sim: ParticleSim
  private readonly geometry = new THREE.InstancedBufferGeometry()
  private readonly material: THREE.ShaderMaterial
  private readonly mesh: THREE.Mesh

  private readonly anchorPosition = new THREE.Vector3()

  constructor(sim: ParticleSim, parent: THREE.Object3D, reducedMotion: boolean, depthOfField: boolean) {
    this.sim = sim
    const quad = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0])
    this.geometry.setAttribute('position', new THREE.BufferAttribute(quad, 3))
    this.geometry.setIndex([0, 1, 2, 0, 2, 3])
    this.geometry.instanceCount = sim.count

    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      defines: { SIM_SIZE: sim.size, INTRO_BURST: INTRO.burst.toFixed(3), SPARK_SHARE: INTRO.sparkShare.toFixed(3) },
      uniforms: {
        tPosition: { value: null },
        tVelocity: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uPixelRatio: { value: 1 },
        uSize: { value: particleSize(window.innerWidth, sim.count) },
        uAlpha: { value: Math.min(1, 1.25 * (BASE_COUNT / sim.count) ** 0.45) },
        uTime: { value: 0 },
        uMotion: { value: reducedMotion ? 0 : 1 },
        uStreak: { value: STREAK_SECONDS },
        uColorA: { value: sceneColor(PALETTE.a) },
        uColorB: { value: sceneColor(PALETTE.b) },
        uColorC: { value: sceneColor(PALETTE.c) },
        uColorHot: { value: sceneColor(PALETTE.hot) },
        uFocus: { value: 6 },
        uIntro: { value: 1 },
        uDepthOfField: { value: depthOfField && !reducedMotion ? 1 : 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false // particles move on the GPU, so the CPU-side bounds are meaningless
    parent.add(this.mesh)
  }

  update(_dt: number, state: FrameState) {
    const u = this.material.uniforms
    u.tPosition.value = this.sim.positionTexture
    u.tVelocity.value = this.sim.velocityTexture
    u.uTime.value = state.time
    u.uIntro.value = state.intro
    // Focus on the shape itself.
    u.uFocus.value = state.camera.position.distanceTo(state.anchor.getWorldPosition(this.anchorPosition))
  }

  resize(state: FrameState) {
    const u = this.material.uniforms
    u.uResolution.value.set(state.width * state.pixelRatio, state.height * state.pixelRatio)
    u.uPixelRatio.value = state.pixelRatio
    u.uSize.value = particleSize(state.width, this.sim.count)
  }

  dispose() {
    this.mesh.removeFromParent()
    this.geometry.dispose()
    this.material.dispose()
  }
}
