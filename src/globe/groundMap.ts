import { PLANET } from '../config.ts';

// Where a ground texture sits on the globe, in real metres. The land mesh is drawn from lon/lat cells, but a 2 m tile cannot
// be placed from a float32 position on a 6,915 km sphere (about half a metre per step), so the texture coordinate is built
// in two parts: a node's origin worked out here in doubles (reduced to its place in one period Q), and each vertex's
// offset from that origin, worked out in the vertex shader by differences that stay small (GROUND_VERT_GLSL).
// The projection is Lambert conformal conic: no shear, the same scale both ways, and a scale of 1 on its standard parallels,
// so the grid is metres to within 6% from 22°N (Dorne's south coast) to 70°N (past the Wall, at 62°), 13% at 77°. The shader
// tiles it at powers of two of a metre, whichever fits the pixel (ground.ts), so the photos show at every altitude.

export const Q = 16384; // m: the period tiles of 2^k m (k <= 14) divide, so a node's origin may be reduced mod Q without a seam
const R = PLANET.radius;
const P1 = (30 * Math.PI) / 180, P2 = (66 * Math.PI) / 180, P0 = (50 * Math.PI) / 180; // standard parallels, origin latitude
export const L0 = 0; // central meridian: King's Landing's, the map's 0°
const tanHalf = (p: number) => Math.tan(Math.PI / 4 + p / 2);
export const LCC_N = Math.log(Math.cos(P1) / Math.cos(P2)) / Math.log(tanHalf(P2) / tanHalf(P1));
const F = (Math.cos(P1) * tanHalf(P1) ** LCC_N) / LCC_N;
const rho = (p: number) => (R * F) / tanHalf(p) ** LCC_N;
export const RHO0 = rho(P0);
export const RF = R * F; // rho = RF / tan^n(pi/4 + lat/2)

/** The cone's grid at a point: metres east (x) and north (y), then reduced mod Q; also the radius and angle the shader needs. */
export function origin(lon: number, lat: number, out = { x: 0, y: 0, rho: 0, theta: 0 }) {
  const r = rho(lat), t = LCC_N * (lon - L0), mod = (v: number) => ((v % Q) + Q) % Q;
  out.x = mod(r * Math.sin(t)); out.y = mod(RHO0 - r * Math.cos(t)); out.rho = r; out.theta = t;
  return out;
}

/** Grid metres by the same formulas as the shader's differences, for the test: the full coordinates, not reduced. */
export function grid(lon: number, lat: number) {
  const r = rho(lat), t = LCC_N * (lon - L0);
  return { x: r * Math.sin(t), y: RHO0 - r * Math.cos(t) };
}

/** Local scale of the grid (grid metres per ground metre) at a latitude. */
export const scaleAt = (lat: number) => (Math.cos(P1) / Math.cos(lat)) * (tanHalf(P1) / tanHalf(lat)) ** LCC_N;

export const MAX_MATERIALS = 32;

/** Vertex shader: the grid offset (m) of a vertex from its node's origin. `d` is the vertex's offset from the origin in
 * longitude and latitude (radians, small), `org` is (x, y, rho, theta) of the origin and `phi` its latitude. Every
 * difference is formed from small terms (sin a - sin b = 2 cos((a+b)/2) sin((a-b)/2)), so there is no cancellation. */
export const GROUND_VERT_GLSL = `
const float LCC_N = ${LCC_N.toFixed(9)};
vec2 groundDelta(vec2 d, vec4 org, float phi) {
  float s0 = sin(phi), s1 = sin(phi + d.y);
  float q = 2.0 * cos(phi + 0.5 * d.y) * sin(0.5 * d.y) / (1.0 - s0 * s1);  // tanh of the change in isometric latitude
  float dL = q + q * q * q / 3.0;
  float x = -LCC_N * dL, em1 = x * (1.0 + x * (0.5 + x * (1.0 / 6.0 + x * (1.0 / 24.0 + x / 120.0)))); // exp(x) - 1
  float dRho = org.z * em1, dT = LCC_N * d.x, t1 = org.w + dT;
  float sd = 2.0 * cos(org.w + 0.5 * dT) * sin(0.5 * dT), cd = -2.0 * sin(org.w + 0.5 * dT) * sin(0.5 * dT);
  return vec2(dRho * sin(t1) + org.z * sd, -(dRho * cos(t1) + org.z * cd));
}`;
