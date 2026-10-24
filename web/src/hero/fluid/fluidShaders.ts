// GLSL for the stable-fluids solver (Stam 1999, as laid out for GPUs in GPU Gems ch. 38).
// Units: the grid covers the canvas; distances are in canvas heights, so a cell is 1/H high and
// wide (H = grid height). Velocity is in canvas heights per second, with +y up.

// Every pass draws one full-screen triangle pair and can read its four neighbours.
export const baseVertex = /* glsl */ `
uniform vec2 uTexel;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  vL = vUv - vec2(uTexel.x, 0.0);
  vR = vUv + vec2(uTexel.x, 0.0);
  vT = vUv + vec2(0.0, uTexel.y);
  vB = vUv - vec2(0.0, uTexel.y);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

// Adds a soft Gaussian blob of velocity or dye.
export const splatShader = /* glsl */ `
uniform sampler2D tTarget;
uniform float uAspect;
uniform vec2 uPoint;
uniform vec3 uValue;
uniform float uRadius;
varying vec2 vUv;

void main() {
  vec2 offset = vUv - uPoint;
  offset.x *= uAspect;
  float blob = exp(-dot(offset, offset) / uRadius);
  gl_FragColor = vec4(texture2D(tTarget, vUv).xyz + uValue * blob, 1.0);
}
`

// Semi-Lagrangian advection: look back along the velocity and take what was there.
export const advectShader = /* glsl */ `
uniform sampler2D tVelocity;
uniform sampler2D tSource;
uniform float uAspect;
uniform float uDt;
uniform float uDissipation;
varying vec2 vUv;

void main() {
  vec2 velocity = texture2D(tVelocity, vUv).xy;
  vec2 from = vUv - velocity * uDt * vec2(1.0 / uAspect, 1.0);
  gl_FragColor = texture2D(tSource, from) / (1.0 + uDissipation * uDt);
}
`

// Vorticity (the z of the 2D curl), per cell.
export const curlShader = /* glsl */ `
uniform sampler2D tVelocity;
uniform float uCell;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

void main() {
  float dvy = texture2D(tVelocity, vR).y - texture2D(tVelocity, vL).y;
  float dvx = texture2D(tVelocity, vT).x - texture2D(tVelocity, vB).x;
  gl_FragColor = vec4((dvy - dvx) / (2.0 * uCell), 0.0, 0.0, 1.0);
}
`

// Vorticity confinement puts back the small swirls that advection smears away.
export const vorticityShader = /* glsl */ `
uniform sampler2D tVelocity;
uniform sampler2D tCurl;
uniform float uCell;
uniform float uStrength;
uniform float uDt;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

void main() {
  float curl = texture2D(tCurl, vUv).x;
  // Points from weaker towards stronger vorticity.
  vec2 eta = vec2(
    abs(texture2D(tCurl, vR).x) - abs(texture2D(tCurl, vL).x),
    abs(texture2D(tCurl, vT).x) - abs(texture2D(tCurl, vB).x)
  );
  vec2 n = eta / (length(eta) + 1e-5);
  vec2 force = uStrength * uCell * vec2(n.y, -n.x) * curl;
  gl_FragColor = vec4(texture2D(tVelocity, vUv).xy + force * uDt, 0.0, 1.0);
}
`

export const divergenceShader = /* glsl */ `
uniform sampler2D tVelocity;
uniform float uCell;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

void main() {
  float dx = texture2D(tVelocity, vR).x - texture2D(tVelocity, vL).x;
  float dy = texture2D(tVelocity, vT).y - texture2D(tVelocity, vB).y;
  gl_FragColor = vec4((dx + dy) / (2.0 * uCell), 0.0, 0.0, 1.0);
}
`

// Scales last step's pressure down: a warm start for the Jacobi solve that still lets it relax.
export const fadeShader = /* glsl */ `
uniform sampler2D tSource;
uniform float uFactor;
varying vec2 vUv;

void main() {
  gl_FragColor = texture2D(tSource, vUv) * uFactor;
}
`

// One Jacobi iteration of the pressure Poisson equation: laplacian(p) = divergence.
export const pressureShader = /* glsl */ `
uniform sampler2D tPressure;
uniform sampler2D tDivergence;
uniform float uCell;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

void main() {
  float neighbours = texture2D(tPressure, vL).x + texture2D(tPressure, vR).x
                   + texture2D(tPressure, vT).x + texture2D(tPressure, vB).x;
  float divergence = texture2D(tDivergence, vUv).x;
  gl_FragColor = vec4((neighbours - divergence * uCell * uCell) * 0.25, 0.0, 0.0, 1.0);
}
`

// Subtracting the pressure gradient leaves a divergence-free (swirly, incompressible) velocity.
export const gradientShader = /* glsl */ `
uniform sampler2D tVelocity;
uniform sampler2D tPressure;
uniform float uCell;
varying vec2 vUv;
varying vec2 vL;
varying vec2 vR;
varying vec2 vT;
varying vec2 vB;

void main() {
  vec2 gradient = vec2(
    texture2D(tPressure, vR).x - texture2D(tPressure, vL).x,
    texture2D(tPressure, vT).x - texture2D(tPressure, vB).x
  ) / (2.0 * uCell);
  gl_FragColor = vec4(texture2D(tVelocity, vUv).xy - gradient, 0.0, 1.0);
}
`

// The faint dye, drawn behind the particles as a soft glow.
export const underlayVertex = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export const underlayFragment = /* glsl */ `
uniform sampler2D tDye;
uniform float uIntensity;
varying vec2 vUv;

void main() {
  vec3 dye = texture2D(tDye, vUv).rgb;
  // Soft knee so dense dye glows instead of clipping.
  gl_FragColor = vec4(dye / (1.0 + dye) * uIntensity, 1.0);
}
`
