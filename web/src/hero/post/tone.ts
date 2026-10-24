import * as THREE from 'three'

// The post chain tone maps with three's ACES Filmic fit, which crushes dark violets towards black
// and shifts hues. Colours we author as display sRGB (the tokens.css palette) are pushed through
// the exact inverse first, so a lone value comes out of the chain as the colour we asked for, and
// only the extra energy (overlapping particles, bloom) gets the filmic highlight roll-off.
// Assumes toneMappingExposure = 1.

// Inverse of RRTAndODTFit: y = (x² + 0.0245786x − 0.000090537) / (0.983729x² + 0.4329510x + 0.238081),
// solved for x (the positive root).
export const displayToScene = /* glsl */ `
vec3 inverseRRTAndODTFit(vec3 y) {
  vec3 a = 1.0 - 0.983729 * y;
  vec3 b = 0.0245786 - 0.4329510 * y;
  vec3 c = -(0.000090537 + 0.238081 * y);
  return (-b + sqrt(max(b * b - 4.0 * a * c, 0.0))) / (2.0 * a);
}

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

// Display sRGB (0..1) → the scene-linear value that tone maps back to it.
vec3 displayToScene(vec3 srgb) {
  const mat3 acesInput = mat3(
    vec3(0.59719, 0.07600, 0.02840),
    vec3(0.35458, 0.90834, 0.13383),
    vec3(0.04823, 0.01566, 0.83777)
  );
  const mat3 acesOutput = mat3(
    vec3(1.60475, -0.10208, -0.00327),
    vec3(-0.53108, 1.10813, -0.07276),
    vec3(-0.07367, -0.00605, 1.07602)
  );
  vec3 v = inverse(acesOutput) * clamp(srgbToLinear(srgb), 0.0, 0.98);
  v = inverseRRTAndODTFit(max(v, 0.0));
  return max(inverse(acesInput) * v * 0.6, 0.0);
}
`

const ACES_INPUT = new THREE.Matrix3().set(0.59719, 0.35458, 0.04823, 0.076, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777)
const ACES_OUTPUT = new THREE.Matrix3().set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602)
const INPUT_INVERSE = ACES_INPUT.clone().invert()
const OUTPUT_INVERSE = ACES_OUTPUT.clone().invert()

function inverseFit(y: number) {
  const a = 1 - 0.983729 * y
  const b = 0.0245786 - 0.432951 * y
  const c = -(0.000090537 + 0.238081 * y)
  return (-b + Math.sqrt(Math.max(b * b - 4 * a * c, 0))) / (2 * a)
}

// The same transform on the CPU, for colour uniforms: a hex from tokens.css → scene-linear colour.
export function sceneColor(hex: string, scale = 1): THREE.Color {
  const linear = new THREE.Color(hex)
  const v = new THREE.Vector3(Math.min(linear.r, 0.98), Math.min(linear.g, 0.98), Math.min(linear.b, 0.98))
  v.applyMatrix3(OUTPUT_INVERSE)
  v.set(inverseFit(Math.max(v.x, 0)), inverseFit(Math.max(v.y, 0)), inverseFit(Math.max(v.z, 0)))
  v.applyMatrix3(INPUT_INVERSE).multiplyScalar(0.6 * scale)
  return new THREE.Color(Math.max(v.x, 0), Math.max(v.y, 0), Math.max(v.z, 0))
}
