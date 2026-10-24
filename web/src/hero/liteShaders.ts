// GLSL for the lite (v1) hero particles. uIntro (0 → 1) gathers the dust cloud into the first shape;
// uScroll (0 → 3) then morphs frame → phone → captions → laptop as the visitor scrolls.

export const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uIntro;
uniform float uScroll;
uniform float uSize;
uniform float uPixelRatio;
uniform float uMotion;
uniform vec3 uMouse;          // cursor position in the particles' own space
uniform float uMouseStrength; // 0 when the cursor is away, 1 when it's over the hero
uniform float uMouseRadius;

attribute vec3 aCloud;
attribute vec3 aFrame;
attribute vec3 aPhone;
attribute vec3 aCaptions;
attribute vec3 aLaptop;
attribute float aRandom;
attribute float aScale;

varying float vRandom;
varying float vAlpha;
varying float vHeat;

// Each particle sets off a little later than its neighbours, so shapes dissolve and re-form organically.
float stagger(float t) {
  return smoothstep(0.0, 1.0, clamp((t - aRandom * 0.35) / 0.65, 0.0, 1.0));
}

void main() {
  float s1 = stagger(clamp(uScroll, 0.0, 1.0));
  float s2 = stagger(clamp(uScroll - 1.0, 0.0, 1.0));
  float s3 = stagger(clamp(uScroll - 2.0, 0.0, 1.0));
  float intro = stagger(uIntro);

  vec3 pos = mix(aFrame, aPhone, s1);
  pos = mix(pos, aCaptions, s2);
  pos = mix(pos, aLaptop, s3);
  pos = mix(aCloud, pos, intro);

  // Swirl hardest halfway through a morph, then settle into a gentle drift.
  float transit = sin(s1 * 3.14159) + sin(s2 * 3.14159) + sin(s3 * 3.14159) + sin(intro * 3.14159);
  float t = uTime * 0.6 + aRandom * 6.28318;
  vec3 swirl = vec3(sin(t * 1.3 + pos.y * 2.0), cos(t * 1.1 + pos.x * 2.0), sin(t * 0.9 + pos.x + pos.y));
  pos += swirl * (0.01 + 0.22 * transit) * uMotion;

  // Particles near the cursor heat up and part around it, bulging towards the viewer.
  vec2 away = pos.xy - uMouse.xy;
  float heat = smoothstep(uMouseRadius, 0.0, length(away)) * uMouseStrength;
  pos.xy += normalize(away + 0.0001) * heat * (0.18 + 0.12 * aRandom);
  pos.z += heat * 0.35;
  vHeat = heat;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = uSize * aScale * uPixelRatio / -mvPosition.z;

  vRandom = aRandom;
  float twinkle = 0.55 + 0.45 * (0.5 + 0.5 * sin(uTime * 2.0 + aRandom * 40.0));
  vAlpha = mix(1.0, twinkle, uMotion);
}
`

export const fragmentShader = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;

varying float vRandom;
varying float vAlpha;
varying float vHeat;

void main() {
  // Soft round glow instead of a hard square point.
  float glow = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
  glow *= glow;

  vec3 color = mix(uColorA, uColorB, smoothstep(0.15, 0.85, vRandom));
  color = mix(color, uColorC, step(0.94, vRandom));
  // Heated particles run hot pink-white.
  color = mix(color, vec3(1.0, 0.82, 0.98), vHeat * 0.75);
  gl_FragColor = vec4(color, glow * min(vAlpha + vHeat, 1.6));
}
`
