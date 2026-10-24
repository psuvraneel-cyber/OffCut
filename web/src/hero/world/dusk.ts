// The dusk palette shared by the sky, the mountains' haze and the ground's fog, so everything fades
// into exactly the colour of the horizon behind it. Display sRGB (0..1), from tokens.css.
export const duskSky = /* glsl */ `
const vec3 DUSK_NIGHT = vec3(18.0, 11.0, 36.0) / 255.0;      // --night
const vec3 DUSK_VIOLET = vec3(33.0, 17.0, 74.0) / 255.0;     // a deep --violet-deep
const vec3 DUSK_ORCHID = vec3(215.0, 123.0, 255.0) / 255.0;  // --orchid
const vec3 DUSK_LILAC = vec3(201.0, 184.0, 255.0) / 255.0;   // --lilac
const vec3 DUSK_SIGNAL = vec3(111.0, 227.0, 255.0) / 255.0;  // --signal

// Sky colour for a world-space view direction: night overhead, violet lower down and an orchid
// glow along the horizon, strongest a little right of straight ahead (behind the shape).
vec3 duskSkyColor(vec3 dir) {
  float elevation = max(dir.y, 0.0);
  float azimuth = atan(dir.x, -dir.z);
  vec3 color = mix(DUSK_VIOLET, DUSK_NIGHT, smoothstep(0.0, 0.35, elevation));
  float glow = exp(-elevation * 14.0) * (0.35 + 0.65 * exp(-pow(azimuth - 0.3, 2.0) * 2.0));
  return mix(color, DUSK_ORCHID, glow * 0.38);
}

// The horizon colour in the same direction: what distant things fade into.
vec3 duskHaze(vec3 dir) {
  return duskSkyColor(normalize(vec3(dir.x, 0.0, dir.z)));
}
`
