// GLSL noise shared by the particle simulation and the world shaders.
//
// simplexNoise3 and simplexNoise3Grad are adapted from webgl-noise (noise3D.glsl):
//   Description : Array and textureless GLSL 2D/3D/4D simplex noise functions.
//        Author : Ian McEwan, Ashima Arts.
//    Maintainer : stegu
//       License : Copyright (C) 2011 Ashima Arts. All rights reserved.
//                 Distributed under the MIT License. See web/THIRD_PARTY_NOTICES.md.
//                 https://github.com/ashima/webgl-noise
//                 https://github.com/stegu/webgl-noise
// Changes: the gradient variant also returns the analytic derivative, and curlNoise is ours.

const simplexCore = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

// Shared corner and gradient set-up for both noise functions below.
void simplexCorners(vec3 v, out vec3 x0, out vec3 x1, out vec3 x2, out vec3 x3,
                    out vec3 p0, out vec3 p1, out vec3 p2, out vec3 p3) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  // First corner
  vec3 i = floor(v + dot(v, C.yyy));
  x0 = v - i + dot(i, C.xxx);

  // Other corners
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  x1 = x0 - i1 + C.xxx;
  x2 = x0 - i2 + C.yyy;
  x3 = x0 - D.yyy;

  // Permutations
  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  // Gradients: 7x7 points over a square, mapped onto an octahedron.
  float n_ = 0.142857142857; // 1.0 / 7.0
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  p0 = vec3(a0.xy, h.x);
  p1 = vec3(a0.zw, h.y);
  p2 = vec3(a1.xy, h.z);
  p3 = vec3(a1.zw, h.w);

  // Normalise gradients
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
}
`

export const simplexNoise3 = /* glsl */ `
${simplexCore}

// Simplex noise in roughly -1..1.
float snoise(vec3 v) {
  vec3 x0, x1, x2, x3, p0, p1, p2, p3;
  simplexCorners(v, x0, x1, x2, x3, p0, p1, p2, p3);
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`

export const simplexNoise3Grad = /* glsl */ `
${simplexCore}

// Simplex noise with its analytic gradient: xyz = d(noise)/d(v), w = noise.
vec4 snoiseGrad(vec3 v) {
  vec3 x0, x1, x2, x3, p0, p1, p2, p3;
  simplexCorners(v, x0, x1, x2, x3, p0, p1, p2, p3);
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  vec4 m2 = m * m;
  vec4 m4 = m2 * m2;
  vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
  // d(m^4)/dx = -8 m^3 x, so each corner adds m^4 * g - 8 m^3 (g . x) x.
  vec4 t = m2 * m * pdotx;
  vec3 grad = -8.0 * (t.x * x0 + t.y * x1 + t.z * x2 + t.w * x3);
  grad += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
  return 105.0 * vec4(grad, dot(m4, pdotx));
}
`

// Divergence-free flow: the curl of a vector potential made of three decorrelated noise fields.
// Particles following it swirl like smoke instead of bunching up or spreading out.
export const curlNoise = /* glsl */ `
${simplexNoise3Grad}

vec3 curlNoise(vec3 p) {
  vec3 a = snoiseGrad(p).xyz;
  vec3 b = snoiseGrad(p + vec3(31.416, -47.853, 12.679)).xyz;
  vec3 c = snoiseGrad(p + vec3(-233.145, -113.408, -185.31)).xyz;
  // Potential (a, b, c): curl = (dc/dy - db/dz, da/dz - dc/dx, db/dx - da/dy).
  return vec3(c.y - b.z, a.z - c.x, b.x - a.y);
}
`
