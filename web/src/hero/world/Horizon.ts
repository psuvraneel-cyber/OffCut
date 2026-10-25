import * as THREE from 'three'
import type { FrameState, HeroSystem } from '../engine/types'
import { dyeGlow } from '../fluid/fluidShaders'
import type { FluidSim } from '../fluid/FluidSim'
import { displayToScene } from '../post/tone'
import { duskSky } from './dusk'

// The world is laid out around the shape, which floats at the origin above a video-editor timeline
// that runs to the horizon. Units match the shapes (about 2.5 wide).
export const GROUND_Y = -2.6
// The timeline slides this far towards the camera per scroll step.
const SLIDE_PER_STEP = 6
// The playhead glows across the timeline, far enough out to sit just below the shape on screen.
const PLAYHEAD_Z = -12

interface Range {
  z: number
  height: number
  // How much of the horizon haze it's lost in (0 = crisp, 1 = gone).
  fog: number
  // Extra edge blur, so distant ranges are softer: a baked depth of field.
  softness: number
  bars: boolean
  seed: number
  rim: number
}

// Far to near. Low tier keeps only the middle (bar) range.
const RANGES: Range[] = [
  { z: -74, height: 9, fog: 0.7, softness: 0.25, bars: false, seed: 1.3, rim: 0.2 },
  { z: -50, height: 5.5, fog: 0.45, softness: 0.06, bars: true, seed: 4.7, rim: 0.5 },
  { z: -33, height: 3, fog: 0.25, softness: 0.02, bars: false, seed: 8.1, rim: 0.55 },
]

const worldVertex = /* glsl */ `
varying vec3 vWorld;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

// A silhouette whose ridgeline is an audio waveform: either rounded bars or smooth peaks, under a
// slow swell, with a faint orchid rim along the top and haze that thickens with distance.
const mountainFragment = /* glsl */ `
uniform float uHeight;
uniform float uFog;
uniform float uSoftness;
uniform float uSeed;
uniform float uBars;
uniform float uRim;
varying vec3 vWorld;

${duskSky}
${displayToScene}
${dyeGlow}

#define GROUND_Y ${GROUND_Y.toFixed(2)}
#define BAR_WIDTH 0.9
#define BAR_HALF 0.32

float hash1(float n) {
  return fract(sin(n * 91.345 + uSeed * 17.13) * 43758.5453);
}

float noise1(float x) {
  float i = floor(x);
  float f = fract(x);
  return mix(hash1(i), hash1(i + 1.0), f * f * (3.0 - 2.0 * f));
}

void main() {
  float x = vWorld.x;
  float y = vWorld.y - GROUND_Y;
  float envelope = 0.3 + 0.7 * noise1(x * 0.045 + uSeed);
  float top;
  float sides = 1.0;
  if (uBars > 0.5) {
    // Waveform bars with rounded caps, standing on a low floor.
    float u = fract(x / BAR_WIDTH) - 0.5;
    float amplitude = envelope * (0.3 + 0.7 * hash1(floor(x / BAR_WIDTH)));
    float r = BAR_HALF * BAR_WIDTH;
    float dx = u * BAR_WIDTH;
    top = amplitude * uHeight - r + sqrt(max(r * r - dx * dx, 0.0));
    float sideBlur = fwidth(u) + uSoftness * 0.1;
    sides = 1.0 - smoothstep(BAR_HALF - sideBlur, BAR_HALF + sideBlur, abs(u));
    top = max(top * sides, uHeight * 0.08);
  } else {
    float peaks = 0.6 * noise1(x * 0.22 + uSeed) + 0.4 * noise1(x * 0.6 + uSeed * 2.0);
    top = envelope * (0.45 + 0.55 * peaks) * uHeight;
  }

  float edge = fwidth(y) + uSoftness;
  float coverage = 1.0 - smoothstep(top - edge, top + edge, y);
  if (coverage <= 0.0) discard;

  vec3 haze = duskHaze(normalize(vWorld - cameraPosition));
  vec3 color = mix(DUSK_NIGHT * 0.9, haze, uFog);
  // Ground mist at the foot of the range.
  color = mix(color, haze, smoothstep(0.35, 0.0, y / uHeight) * 0.45);
  // Rim light along the ridge.
  color += DUSK_ORCHID * exp(-max(top - y, 0.0) / 0.08) * uRim * (1.0 - uFog * 0.6);

  gl_FragColor = vec4(displayToScene(clamp(color, 0.0, 0.95)) + dyeGlow(), coverage);
}
`

// The timeline floor: track lanes running to the horizon, rounded clips in palette colours,
// keyframe diamonds, a glowing playhead, a sheen near the horizon and fog over the distance.
const groundFragment = /* glsl */ `
uniform float uOffset;
varying vec3 vWorld;

${duskSky}
${displayToScene}
${dyeGlow}

#define LANE 1.15
#define PLAYHEAD_Z ${PLAYHEAD_Z.toFixed(2)}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float roundedBox(vec2 p, vec2 halfSize, float r) {
  vec2 q = abs(p) - halfSize + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec3 view = vWorld - cameraPosition;
  float dist = length(view);
  vec3 dir = view / dist;
  vec2 p = vec2(vWorld.x, vWorld.z - uOffset);

  // Lanes run along z; each holds a sequence of clips of random length and colour.
  float lane = floor(p.x / LANE);
  float across = (fract(p.x / LANE) - 0.5) * LANE;
  float spacing = 5.0 + 3.0 * hash(vec2(lane, 0.5));
  float along = p.y / spacing + hash(vec2(lane, 1.5)) * 10.0;
  float id = floor(along);
  float local = (fract(along) - 0.5) * spacing;
  float h = hash(vec2(lane, id));
  float clipLength = spacing * (0.35 + 0.5 * hash(vec2(id, lane + 3.0)));
  float present = step(0.28, h);
  float d = roundedBox(vec2(across, local), vec2(LANE * 0.36, clipLength * 0.5), 0.12);
  float aa = fwidth(d) + 0.002;
  float fill = (1.0 - smoothstep(-aa, aa, d)) * present;
  float outline = (1.0 - smoothstep(0.0, aa * 1.5 + 0.015, abs(d))) * present;

  float pick = hash(vec2(id + 7.0, lane));
  vec3 clipColor = pick < 0.45 ? vec3(122.0, 77.0, 255.0) / 255.0
    : pick < 0.8 ? DUSK_ORCHID
    : pick < 0.94 ? DUSK_LILAC
    : DUSK_SIGNAL;

  // Keyframe diamonds along some clips' centre lines.
  float key = (fract(local / 1.1 + h * 3.0) - 0.5) * 1.1;
  float diamond = 1.0 - smoothstep(0.09 - aa, 0.09 + aa, abs(across) + abs(key));
  diamond *= fill * step(0.55, hash(vec2(id, lane + 9.0)));
  float laneLine = 1.0 - smoothstep(0.0, fwidth(p.x) * 1.2 + 0.006, abs(abs(across) - LANE * 0.5));
  // Fine detail fades out where it would shimmer in the distance.
  float detail = 1.0 - smoothstep(0.08, 0.5, fwidth(p.y));

  vec3 color = DUSK_NIGHT * 0.6;
  color = mix(color, clipColor * 0.1, fill * 0.9);
  color += clipColor * outline * 0.16 * detail;
  color += DUSK_LILAC * diamond * 0.32 * detail;
  color += DUSK_LILAC * laneLine * 0.035 * detail;

  // The playhead: a hot line with a soft glow.
  float fromPlayhead = abs(vWorld.z - PLAYHEAD_Z);
  float core = 1.0 - smoothstep(0.0, fwidth(vWorld.z) * 1.5 + 0.05, fromPlayhead);
  color += DUSK_ORCHID * exp(-fromPlayhead * 1.2) * 0.2 + vec3(1.0, 0.92, 1.0) * core * 0.75;

  // The horizon glow, reflected at grazing angles, then fog into the haze.
  vec3 haze = duskHaze(dir);
  color += haze * pow(1.0 - abs(dir.y), 8.0) * 0.12;
  color = mix(color, haze, 1.0 - exp(-dist * 0.022));

  gl_FragColor = vec4(displayToScene(clamp(color, 0.0, 0.95)) + dyeGlow(), 1.0);
}
`

// Waveform mountains and the timeline ground. Rendered before the particles, so bloom applies to
// them and the particles are hidden behind them.
export class Horizon implements HeroSystem {
  private readonly meshes: THREE.Mesh[] = []
  private readonly materials: THREE.ShaderMaterial[] = []
  private readonly groundMaterial: THREE.ShaderMaterial

  constructor(scene: THREE.Scene, layers: number, fluid: FluidSim | null) {
    const dye = fluid ? { defines: { DYE: '' }, uniforms: fluid.dyeUniforms } : { defines: {}, uniforms: {} }
    const ranges = layers >= RANGES.length ? RANGES : RANGES.slice(1, 1 + Math.max(layers, 1))
    ranges.forEach((range, i) => {
      const material = new THREE.ShaderMaterial({
        vertexShader: worldVertex,
        fragmentShader: mountainFragment,
        defines: dye.defines,
        uniforms: {
          ...dye.uniforms,
          uHeight: { value: range.height },
          uFog: { value: range.fog },
          uSoftness: { value: range.softness },
          uSeed: { value: range.seed },
          uBars: { value: range.bars ? 1 : 0 },
          uRim: { value: range.rim },
        },
        transparent: true,
      })
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(240, range.height + 1), material)
      mesh.position.set(0, GROUND_Y + (range.height + 1) / 2, range.z)
      // Far ranges first, so each nearer one blends over it.
      mesh.renderOrder = -6 + i
      this.meshes.push(mesh)
      this.materials.push(material)
    })

    this.groundMaterial = new THREE.ShaderMaterial({
      vertexShader: worldVertex,
      fragmentShader: groundFragment,
      defines: dye.defines,
      uniforms: { uOffset: { value: 0 }, ...dye.uniforms },
    })
    // Big enough to reach the horizon whichever way the camera swings.
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), this.groundMaterial)
    ground.rotation.x = -Math.PI / 2
    ground.position.set(0, GROUND_Y, -30)
    ground.renderOrder = -8
    this.meshes.push(ground)
    this.materials.push(this.groundMaterial)

    for (const mesh of this.meshes) {
      mesh.frustumCulled = false
      scene.add(mesh)
    }
  }

  update(_dt: number, state: FrameState) {
    this.groundMaterial.uniforms.uOffset.value = state.scroll * SLIDE_PER_STEP
  }

  dispose() {
    for (const mesh of this.meshes) {
      mesh.removeFromParent()
      mesh.geometry.dispose()
    }
    for (const material of this.materials) material.dispose()
  }
}
