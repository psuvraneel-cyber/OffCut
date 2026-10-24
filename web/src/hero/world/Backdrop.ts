import * as THREE from 'three'
import type { HeroSystem } from '../engine/types'
import { displayToScene } from '../post/tone'

// The CSS stage gradient (Hero.css) redrawn in WebGL, because post-processing needs an opaque
// canvas. Same stops and glows, mixed in sRGB like the browser does, then pre-inverted through the
// tone mapper so it comes out of the post chain matching the CSS.
const fragmentShader = /* glsl */ `
varying vec2 vUv;

${displayToScene}

vec3 srgb(float r, float g, float b) { return vec3(r, g, b) / 255.0; }

// A CSS radial-gradient glow: full colour at the centre, transparent at 70% of the radius.
float glow(vec2 uv, vec2 centre, vec2 radius) {
  return clamp(1.0 - length((uv - centre) / radius) / 0.7, 0.0, 1.0);
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y); // CSS coordinates: y down
  vec3 color = mix(srgb(22.0, 13.0, 46.0), srgb(18.0, 11.0, 36.0), clamp(uv.y / 0.6, 0.0, 1.0));
  color = mix(color, srgb(215.0, 123.0, 255.0), 0.22 * glow(uv, vec2(0.15, 1.0), vec2(0.6, 0.45)));
  color = mix(color, srgb(122.0, 77.0, 255.0), 0.35 * glow(uv, vec2(0.72, 0.45), vec2(0.7, 0.55)));
  gl_FragColor = vec4(displayToScene(color), 1.0);
}
`

const vertexShader = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

// Drawn first, behind everything, filling the canvas.
export class Backdrop implements HeroSystem {
  private readonly material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, depthTest: false, depthWrite: false })
  private readonly mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material)

  constructor(scene: THREE.Scene) {
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = -10
    scene.add(this.mesh)
  }

  update() {}

  dispose() {
    this.mesh.removeFromParent()
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
