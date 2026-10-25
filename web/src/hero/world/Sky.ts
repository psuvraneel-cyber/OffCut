import * as THREE from 'three'
import type { FrameState, HeroSystem } from '../engine/types'
import { dyeGlow } from '../fluid/fluidShaders'
import type { FluidSim } from '../fluid/FluidSim'
import { simplexNoise3 } from '../glsl/noise'
import { displayToScene } from '../post/tone'
import { duskSky } from './dusk'

const vertexShader = /* glsl */ `
varying vec3 vDirection;

void main() {
  // The dome is centred on the camera, so a vertex's position is its view direction.
  vDirection = position;
  // Pinned to the far plane, so it's drawn after the ground and skips every pixel the ground covers.
  gl_Position = (projectionMatrix * modelViewMatrix * vec4(position, 1.0)).xyww;
}
`

// Aurora covers this patch of sky (radians): baked into a small texture each frame, because
// evaluating its noise for every sky pixel cost ~15 ms on an integrated GPU.
const AURORA_AZIMUTH = [-1.6, 2.0]
const AURORA_ELEVATION = [0.0, 0.6]

const auroraVertex = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

// Two slow ribbons whose height wanders with fbm, hanging down in faint vertical curtains.
const auroraFragment = /* glsl */ `
uniform float uTime;
varying vec2 vUv;

${duskSky}
${simplexNoise3}

float fbm(vec3 p) {
  return 0.6 * snoise(p) + 0.3 * snoise(p * 2.1 + 7.3) + 0.1 * snoise(p * 4.3 - 3.1);
}

void main() {
  float azimuth = mix(${AURORA_AZIMUTH[0].toFixed(2)}, ${AURORA_AZIMUTH[1].toFixed(2)}, vUv.x);
  float elevation = mix(${AURORA_ELEVATION[0].toFixed(2)}, ${AURORA_ELEVATION[1].toFixed(2)}, vUv.y);
  float drift = uTime * 0.025;
  vec3 color = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    float fi = float(i);
    float height = 0.2 + 0.12 * fi + 0.07 * fbm(vec3(azimuth * 1.3 + fi * 4.0, drift, fi));
    // Sharp-ish crest, long soft fall below it, like a curtain.
    float below = height - elevation;
    float ribbon = below > 0.0 ? exp(-below / (0.05 + 0.03 * fi)) : exp(-pow(below / 0.008, 2.0));
    float curtains = smoothstep(-0.2, 0.9, snoise(vec3(azimuth * 26.0, elevation * 0.6 - drift * 2.0, fi + drift)));
    float reach = smoothstep(-1.4, -0.4, azimuth) * smoothstep(1.8, 0.6, azimuth);
    vec3 tint = mix(DUSK_SIGNAL, DUSK_LILAC, 0.5 + 0.5 * sin(azimuth * 3.0 + fi * 2.0 + drift * 4.0));
    color += tint * ribbon * curtains * reach * (0.1 - 0.03 * fi);
  }
  gl_FragColor = vec4(color, 1.0);
}
`

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uMotion;
uniform sampler2D tAurora;
varying vec3 vDirection;

${duskSky}
${displayToScene}
${dyeGlow}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec3 dir = normalize(vDirection);
  float elevation = dir.y;
  float azimuth = atan(dir.x, -dir.z);
  vec3 color = duskSkyColor(dir);
  float time = uTime * uMotion;

#ifdef AURORA
  vec2 auroraUv = vec2(
    (azimuth - ${AURORA_AZIMUTH[0].toFixed(2)}) / ${(AURORA_AZIMUTH[1] - AURORA_AZIMUTH[0]).toFixed(2)},
    (elevation - ${AURORA_ELEVATION[0].toFixed(2)}) / ${(AURORA_ELEVATION[1] - AURORA_ELEVATION[0]).toFixed(2)}
  );
  if (all(greaterThan(auroraUv, vec2(0.0))) && all(lessThan(auroraUv, vec2(1.0)))) {
    color += texture2D(tAurora, auroraUv).rgb;
  }
#endif

  // Sparse stars, twinkling, fading out towards the horizon glow.
  vec2 cell = vec2(azimuth, elevation) * 90.0;
  vec2 id = floor(cell);
  float seed = hash(id);
  if (seed > 0.965 && elevation > 0.06) {
    vec2 offset = fract(cell) - 0.5 - (vec2(hash(id + 1.7), hash(id + 3.1)) - 0.5) * 0.6;
    float twinkle = 0.65 + 0.35 * sin(time * (1.0 + seed * 3.0) + seed * 50.0);
    float star = smoothstep(0.1, 0.0, length(offset)) * twinkle * smoothstep(0.06, 0.3, elevation);
    color += DUSK_LILAC * star * (0.5 + 0.5 * hash(id + 5.3));
  }

  gl_FragColor = vec4(displayToScene(clamp(color, 0.0, 1.0)) + dyeGlow(), 1.0);
}
`

// The dusk sky dome: drawn first, behind everything, and always centred on the camera.
export class Sky implements HeroSystem {
  private readonly renderer: THREE.WebGLRenderer
  private readonly material: THREE.ShaderMaterial
  private readonly mesh: THREE.Mesh
  private readonly aurora: ReturnType<Sky['createAurora']> | null
  private readonly animated: boolean
  private auroraDrawn = false

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, aurora: boolean, reducedMotion: boolean, fluid: FluidSim | null) {
    this.renderer = renderer
    this.animated = !reducedMotion
    this.aurora = aurora ? this.createAurora() : null
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      defines: { ...(aurora ? { AURORA: '' } : {}), ...(fluid ? { DYE: '' } : {}) },
      uniforms: {
        uTime: { value: 0 },
        uMotion: { value: reducedMotion ? 0 : 1 },
        tAurora: { value: this.aurora?.target.texture ?? null },
        ...fluid?.dyeUniforms,
      },
      side: THREE.BackSide,
      depthWrite: false,
    })
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(90, 48, 24), this.material)
    this.mesh.frustumCulled = false
    // Opaque, after the ground (-8), so the depth test can reject what the ground already covers.
    this.mesh.renderOrder = -7
    scene.add(this.mesh)
  }

  update(_dt: number, state: FrameState) {
    this.mesh.position.copy(state.camera.position)
    this.material.uniforms.uTime.value = state.time
    // Reduced motion draws the aurora once and leaves it still.
    if (this.aurora && (this.animated || !this.auroraDrawn)) {
      const { target, material, scene, camera } = this.aurora
      material.uniforms.uTime.value = state.time
      const previous = this.renderer.getRenderTarget()
      this.renderer.setRenderTarget(target)
      this.renderer.render(scene, camera)
      this.renderer.setRenderTarget(previous)
      this.auroraDrawn = true
    }
  }

  dispose() {
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    this.material.dispose()
    if (this.aurora) {
      this.aurora.target.dispose()
      this.aurora.material.dispose()
      this.aurora.quad.geometry.dispose()
    }
  }

  private createAurora() {
    const target = new THREE.WebGLRenderTarget(512, 128, { type: THREE.HalfFloatType, depthBuffer: false })
    const material = new THREE.ShaderMaterial({
      vertexShader: auroraVertex,
      fragmentShader: auroraFragment,
      uniforms: { uTime: { value: 0 } },
      depthTest: false,
      depthWrite: false,
    })
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    quad.frustumCulled = false
    const scene = new THREE.Scene()
    scene.add(quad)
    return { target, material, quad, scene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) }
  }
}
