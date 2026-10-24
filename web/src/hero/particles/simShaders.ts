import { curlNoise } from '../glsl/noise'

// GPGPU passes for the particles (run by GPUComputationRenderer, which declares texturePosition,
// textureVelocity and `resolution`). Position texels: xyz in shape units, w = per-particle random.
// Velocity texels: xyz in shape units per second, w spare.

export const velocityShader = /* glsl */ `
uniform float uDt;
uniform float uTime;
uniform float uMotion;
// Morph progress between the two shapes either side of the current scroll position (0..1).
uniform float uMorph;
uniform float uIntro;
uniform sampler2D tCloud;
uniform sampler2D tFrom;
uniform sampler2D tTo;
uniform float uStiffness;
uniform float uDamping;
uniform float uCurlScale;
// Swirl while a particle travels between shapes, and the faint drift left at rest.
uniform float uCurlStrength;
uniform float uDrift;
uniform float uMaxSpeed;
uniform vec3 uPointer;
uniform float uPointerStrength;
uniform float uPointerRadius;

${curlNoise}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 data = texture2D(texturePosition, uv);
  vec3 pos = data.xyz;
  float rnd = data.w;
  vec4 velocityData = texture2D(textureVelocity, uv);
  vec3 vel = velocityData.xyz;

  // Each particle switches to the next shape once the morph passes its own threshold, so shapes
  // dissolve and re-form organically (v1's stagger). The intro gathers them out of the dust cloud.
  vec3 target = uMorph > 0.1 + 0.8 * rnd ? texture2D(tTo, uv).xyz : texture2D(tFrom, uv).xyz;
  if (uIntro < 0.05 + 0.6 * rnd) target = texture2D(tCloud, uv).xyz;

  // Spring towards the target, a little stiffer or softer per particle so it doesn't look mechanical.
  vec3 toTarget = target - pos;
  vec3 force = toTarget * uStiffness * (0.75 + 0.5 * fract(rnd * 17.31));

  // Smoke: curl noise is strong while a particle is far from home and fades to a drift at rest.
  // It must be gone well before the target, or it balances the spring and nothing ever settles.
  float transit = smoothstep(0.4, 1.6, length(toTarget));
  vec3 curl = curlNoise(pos * uCurlScale + vec3(0.0, uTime * 0.07, uTime * 0.11));
  force += curl * (uDrift + uCurlStrength * transit) * uMotion;

  // The cursor pushes particles out of its way and towards the viewer.
  vec2 away = pos.xy - uPointer.xy;
  float reach = length(away);
  float push = smoothstep(uPointerRadius, 0.0, reach) * uPointerStrength;
  force.xy += away / max(reach, 1e-4) * push * (0.7 + 0.6 * rnd);
  force.z += push * 0.8;

  vel += force * uDt;
  vel *= exp(-uDamping * uDt);
  float speed = length(vel);
  if (speed > uMaxSpeed) vel *= uMaxSpeed / speed;
  gl_FragColor = vec4(vel, velocityData.w);
}
`

export const positionShader = /* glsl */ `
uniform float uDt;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 data = texture2D(texturePosition, uv);
  vec3 vel = texture2D(textureVelocity, uv).xyz;
  gl_FragColor = vec4(data.xyz + vel * uDt, data.w);
}
`
