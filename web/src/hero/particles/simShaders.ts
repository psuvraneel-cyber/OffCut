import { curlNoise } from '../glsl/noise'
import { INTRO } from '../choreography/intro'
import { CUT_REACH, SHOCK_LIFE, SHOCK_SPEED } from '../interaction/ImpactEffects'

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
// Where each particle starts the intro: in the spark, or lying on the timeline floor.
uniform sampler2D tOrigin;
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
// Swipe to cut: a line through xy along the unit direction zw (shape units); x = the stroke's
// half-length, y = the kick in shape units per second (0 when no cut landed this step).
uniform vec4 uCutLine;
uniform vec2 uCut;
// Tap shockwave: centre (xyz) and seconds since the tap (w), or w < 0 when there's none.
uniform vec4 uShock;

#ifdef FLUID
uniform sampler2D tFluid;
uniform mat4 uLocalToClip;
// Fluid velocity is in canvas heights per second; this converts it to shape units per second.
uniform float uFluidToLocal;
uniform float uFluidStrength;
#endif

#define CUT_REACH ${CUT_REACH.toFixed(3)}
#define INTRO_BURST ${INTRO.burst.toFixed(3)}
#define SPARK_SHARE ${INTRO.sparkShare.toFixed(3)}
#define SHOCK_SPEED ${SHOCK_SPEED.toFixed(3)}
#define SHOCK_LIFE ${SHOCK_LIFE.toFixed(3)}
#define SHOCK_WIDTH 0.18
#define SHOCK_FORCE 70.0

${curlNoise}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 data = texture2D(texturePosition, uv);
  vec3 pos = data.xyz;
  float rnd = data.w;
  vec4 velocityData = texture2D(textureVelocity, uv);
  vec3 vel = velocityData.xyz;

  // Each particle switches to the next shape once the morph passes its own threshold, so shapes
  // dissolve and re-form organically (v1's stagger).
  vec3 target = uMorph > 0.1 + 0.8 * rnd ? texture2D(tTo, uv).xyz : texture2D(tFrom, uv).xyz;

  // The intro: spark particles wait in the spark and burst into the dust cloud; the rest lie on the
  // timeline floor and rise into it; then everyone gathers into the first shape.
  float leave = rnd < SPARK_SHARE ? INTRO_BURST : 0.2 + 0.3 * fract(rnd * 3.7);
  float gather = 0.4 + 0.35 * fract(rnd * 7.31);
  if (uIntro < gather) target = uIntro < leave ? texture2D(tOrigin, uv).xyz : texture2D(tCloud, uv).xyz;

  // Spring towards the target, a little stiffer or softer per particle so it doesn't look mechanical.
  vec3 toTarget = target - pos;
  vec3 force = toTarget * uStiffness * (0.75 + 0.5 * fract(rnd * 17.31));

  // Smoke: curl noise is strong while a particle is far from home and fades to a drift at rest.
  // It must be gone well before the target, or it balances the spring and nothing ever settles.
  float transit = smoothstep(0.4, 1.6, length(toTarget));
  vec3 curl = curlNoise(pos * uCurlScale + vec3(0.0, uTime * 0.07, uTime * 0.11));
  force += curl * (uDrift + uCurlStrength * transit) * uMotion;

  // Without a fluid (low tier) the cursor pushes particles out of its way and towards the viewer.
  vec2 away = pos.xy - uPointer.xy;
  float reach = length(away);
  float push = smoothstep(uPointerRadius, 0.0, reach) * uPointerStrength;
  force.xy += away / max(reach, 1e-4) * push * (0.7 + 0.6 * rnd);
  force.z += push * 0.8;

#ifdef FLUID
  // Stir like ink: where the fluid moves, particles are dragged towards its velocity.
  vec4 clip = uLocalToClip * vec4(pos, 1.0);
  vec2 flow = texture2D(tFluid, clip.xy / clip.w * 0.5 + 0.5).xy * uFluidToLocal;
  force.xy += (flow - vel.xy) * uFluidStrength * smoothstep(0.0, 0.6, length(flow));
#endif

  // The shockwave: an expanding ring that shoves particles outwards as it passes.
  if (uShock.w >= 0.0) {
    vec2 outward = pos.xy - uShock.xy;
    float d = length(outward);
    float wave = exp(-pow((d - uShock.w * SHOCK_SPEED) / SHOCK_WIDTH, 2.0)) * (1.0 - uShock.w / SHOCK_LIFE);
    force.xy += outward / max(d, 1e-3) * wave * SHOCK_FORCE;
    force.z += wave * SHOCK_FORCE * 0.4;
  }

  vel += force * uDt;

  // A cut kicks particles away from the line, each to its own side, so the shape splits in two.
  // A narrow band takes the full kick; the rest of the shape parts gently.
  if (uCut.y > 0.0) {
    vec2 rel = pos.xy - uCutLine.xy;
    vec2 normal = vec2(-uCutLine.w, uCutLine.z);
    float side = dot(rel, normal);
    float along = abs(dot(rel, uCutLine.zw));
    float span = 1.0 - smoothstep(uCut.x + CUT_REACH * 0.5, uCut.x + CUT_REACH, along);
    float hit = (1.0 - smoothstep(0.0, 0.4, abs(side))) + 0.3 * (1.0 - smoothstep(0.0, 1.4, abs(side)));
    hit *= span * uCut.y;
    vel.xy += (normal * sign(side) * (0.6 + 0.8 * rnd) + uCutLine.zw * 0.35) * hit;
    vel.z += (rnd - 0.5) * hit * 0.8;
  }

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
