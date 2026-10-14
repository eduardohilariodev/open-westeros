import * as THREE from 'three';
import { createSiteScene, type Place, type SiteView } from '../SiteScene';
import { BOX, CONE, CYL, ROOF, TREE, instanced, mat, part, type Instance } from '../primitives';
import { LORE } from './lore';

// Fallback Winterfell when the mod import (tools/sites/winterfell) hasn't been run: a procedural approximation
// of the book layout. Frame: metres, x = east, z = south, origin at the castle centre, flat ground at y = 0.

const OUTER = { hx: 234, hz: 254, h: 24, t: 12 }; // 80 ft outer curtain, thick base on the moat bank
const INNER = { hx: 195, hz: 215, h: 30, t: 8 }; // 100 ft inner curtain
type Wall = typeof OUTER;
const GATES: { name: string; side: 'S' | 'W' | 'E'; offset: number }[] = [
  { name: 'South Gate', side: 'S', offset: 0 }, { name: "Hunter's Gate", side: 'W', offset: -60 }, { name: 'East Gate', side: 'E', offset: 40 },
];
/** Gate centre on a given wall. */
const gateAt = (g: (typeof GATES)[number], w: Wall) =>
  g.side === 'S' ? new THREE.Vector3(g.offset, 0, w.hz) : new THREE.Vector3(g.side === 'W' ? -w.hx : w.hx, 0, g.offset);

export async function createProceduralWinterfellView(renderer: THREE.WebGLRenderer, labelsEl: HTMLElement): Promise<SiteView> {
  const site = createSiteScene(renderer, labelsEl, {
    id: 'winterfell', sky: 0xc5ced6, shadowExtent: 900, ground: () => 0, labelMaxDistance: 12_000,
    home: { position: new THREE.Vector3(260, 420, 760), target: new THREE.Vector3(0, 20, 0) },
  });
  const { scene } = site;
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

  const granite = mat(0x8d8b85, { roughness: 0.95 }), dark = mat(0x6c6a64), slate = mat(0x3f444a), wood = mat(0x6b5038);

  // ---------- ground, moat ----------
  const ground = new THREE.Group();
  const g0 = part(BOX, mat(0x6e7a57, { roughness: 1 }), 0, -1, 0, 3000, 1, 3000);
  const moat = part(BOX, mat(0x31464f, { roughness: 0.15, metalness: 0.3 }), 0, -0.7, 0, OUTER.hx * 2, 1, OUTER.hz * 2);
  const yard = part(BOX, mat(0x7c7566, { roughness: 1 }), 0, -0.5, 0, INNER.hx * 2 + 10, 1, INNER.hz * 2 + 10);
  const road = part(BOX, mat(0x8a7f6a, { roughness: 1 }), 0, -0.45, 600, 12, 1, 700);
  ground.add(g0, moat, yard, road);

  // ---------- curtain walls ----------
  function curtain(w: Wall, towerEvery: number, towerR: number) {
    const segs: Instance[] = [], towers: Instance[] = [], caps: Instance[] = [];
    const corners = [[-w.hx, -w.hz], [w.hx, -w.hz], [w.hx, w.hz], [-w.hx, w.hz]];
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az), rot = -Math.atan2(bz - az, bx - ax);
      segs.push({ pos: new THREE.Vector3((ax + bx) / 2, 0, (az + bz) / 2), rot, scale: new THREE.Vector3(len, w.h, w.t) });
      const n = Math.round(len / towerEvery);
      for (let t = 0; t < n; t++) {
        const x = ax + ((bx - ax) * t) / n, z = az + ((bz - az) * t) / n, r = t === 0 ? towerR * 1.4 : towerR;
        towers.push({ pos: new THREE.Vector3(x, 0, z), rot: 0, scale: new THREE.Vector3(r, w.h + 8, r) });
        caps.push({ pos: new THREE.Vector3(x, w.h + 8, z), rot: 0, scale: new THREE.Vector3(r * 1.2, r * 1.6, r * 1.2) });
      }
    }
    const grp = new THREE.Group();
    grp.add(instanced(BOX, granite, segs), instanced(CYL, granite, towers), instanced(CONE, slate, caps));
    return grp;
  }
  const walls = new THREE.Group();
  walls.add(curtain(OUTER, 70, 7), curtain(INNER, 62, 8));
  for (const g of GATES) { // gatehouses on both walls + a drawbridge across the moat
    for (const w of [OUTER, INNER]) {
      const gh = new THREE.Group();
      gh.position.copy(gateAt(g, w));
      gh.rotation.y = g.side === 'S' ? 0 : Math.PI / 2;
      gh.add(part(BOX, dark, 0, 0, 0, 28, w.h + 10, w.t + 10), part(BOX, mat(0x2a2622), 0, 0, 0, 8, 11, w.t + 10.5));
      for (const s of [-1, 1]) gh.add(part(CYL, granite, s * 16, 0, 0, 8, w.h + 16, 8), part(CONE, slate, s * 16, w.h + 16, 0, 9.5, 13, 9.5));
      walls.add(gh);
    }
    const b = gateAt(g, OUTER).add(gateAt(g, INNER)).multiplyScalar(0.5), ns = g.side === 'S';
    walls.add(part(BOX, wood, b.x, 0, b.z, ns ? 10 : OUTER.hx - INNER.hx, 1.2, ns ? OUTER.hz - INNER.hz : 10));
  }

  // ---------- buildings inside ----------
  const castle = new THREE.Group();
  const hall = (x: number, z: number, w: number, d: number, h: number, ry = 0, wall = granite) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    g.add(part(BOX, wall, 0, 0, 0, w, h, d), part(ROOF, slate, 0, h, 0, w * 1.04, Math.min(w, d) * 0.45, d * 1.08));
    castle.add(g);
  };
  const tower = (x: number, z: number, r: number, h: number, roof = true) => {
    castle.add(part(CYL, granite, x, 0, z, r, h, r));
    if (roof) castle.add(part(CONE, slate, x, h, z, r * 1.2, r * 2.2, r * 1.2));
  };
  hall(40, -60, 52, 40, 34); // Great Keep
  tower(66, -80, 7, 46); tower(14, -80, 7, 46); tower(66, -40, 7, 46); tower(14, -40, 7, 46);
  hall(40, 8, 72, 26, 20); // Great Hall
  castle.add(part(CYL, dark, -20, 0, -150, 17, 22, 17), part(CYL, dark, -20, 22, -150, 18.5, 3, 18.5)); // First Keep
  { // Broken Tower: tall shaft with a jagged, open top
    castle.add(part(CYL, granite, 130, 0, -160, 8, 40, 8));
    const ruin = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true, 0.4, Math.PI * 1.3).translate(0, 0.5, 0);
    castle.add(part(ruin, mat(0x7a776f, { side: THREE.DoubleSide }), 130, 40, -160, 8, 9, 8));
  }
  tower(140, 70, 8, 36); // Library Tower
  tower(-30, 70, 6, 40); // Bell Tower
  tower(100, -115, 6, 32); // Maester's Turret
  hall(-80, 160, 50, 18, 14); // Guards Hall
  hall(-140, 115, 30, 20, 10, 0, mat(0x7d7466)); // Armory & smithy
  hall(60, 168, 50, 14, 9, 0, mat(0x7a6650)); // Stables & kennels
  hall(-150, 190, 60, 14, 9); hall(150, -10, 14, 60, 12); hall(-160, 40, 14, 50, 11); // ranges along the inner wall
  { // Glass Gardens
    const glass = mat(0xc4e6dc, { transparent: true, opacity: 0.5, roughness: 0.1, metalness: 0.1 });
    for (const dz of [-12, 12]) {
      castle.add(part(BOX, glass, 130, 0, 150 + dz, 64, 8, 18), part(ROOF, glass, 130, 8, 150 + dz, 64, 6, 18));
    }
  }
  castle.add(part(BOX, dark, -50, 0, -118, 10, 5, 8), part(BOX, mat(0x1d1b19), -50, 0, -113.5, 4, 3.5, 0.5)); // crypt entrance

  // ---------- godswood ----------
  const godswood = new THREE.Group();
  {
    const pines: Instance[] = [], oaks: Instance[] = [];
    for (let i = 0; i < 420; i++) {
      const x = -185 + rnd() * 140, z = -205 + rnd() * 165;
      if (Math.hypot(x + 95, z + 115) < 22) continue; // clearing around the heart tree
      const s = 0.7 + rnd() * 0.6;
      if (rnd() < 0.65) pines.push({ pos: new THREE.Vector3(x, 0, z), rot: 0, scale: new THREE.Vector3(4 * s, 22 * s, 4 * s), color: 0x2f4a33 });
      else oaks.push({ pos: new THREE.Vector3(x, 6 * s, z), rot: rnd() * 6, scale: new THREE.Vector3(7 * s, 8 * s, 7 * s), color: 0x45603a });
    }
    godswood.add(instanced(CONE, mat(0xffffff, { roughness: 1 }), pines), instanced(TREE, mat(0xffffff, { flatShading: true, roughness: 1 }), oaks));
    godswood.add(
      part(CYL, mat(0xe9e5dc), -95, 0, -115, 2.6, 13, 2.6), // weirwood trunk
      part(TREE, mat(0x9e1b14, { flatShading: true }), -95, 17, -115, 11, 8, 11), // red leaves
      part(CYL, mat(0x141c1e, { roughness: 0.1 }), -84, -0.2, -104, 8, 0.6, 8), // black pool
    );
  }

  // ---------- winter town ----------
  const town = (() => {
    const bodies: Instance[] = [], roofs: Instance[] = [];
    for (let i = 0; i < 340; i++) {
      const x = (rnd() - 0.5) * 760, z = 300 + rnd() * 520;
      if (Math.abs(x) < 16) continue; // kingsroad
      const w = 8 + rnd() * 6, d = 6 + rnd() * 3, h = 3.5 + rnd() * 3, rot = (rnd() - 0.5) * 0.4;
      const tone = 0.75 + rnd() * 0.25;
      bodies.push({ pos: new THREE.Vector3(x, 0, z), rot, scale: new THREE.Vector3(w, h, d), color: new THREE.Color(0x8a7a64).multiplyScalar(tone).getHex() });
      roofs.push({ pos: new THREE.Vector3(x, h, z), rot, scale: new THREE.Vector3(w * 1.08, d * 0.5, d * 1.15), color: new THREE.Color(0x4a4640).multiplyScalar(tone).getHex() });
    }
    const g = new THREE.Group();
    g.add(instanced(BOX, mat(0xffffff, { roughness: 1 }), bodies), instanced(ROOF, mat(0xffffff, { roughness: 0.9 }), roofs));
    return g;
  })();

  scene.add(ground, walls, castle, godswood, town);

  // ---------- places ----------
  const P = (name: string, kind: string, x: number, z: number, labelY: number, radius = 40): Place => ({ name, kind, pos: [x, z, labelY], radius });
  const places: Place[] = [
    P('Great Keep', 'keep', 40, -60, 70, 60), P('Great Hall', 'hall', 40, 8, 40, 50), P('First Keep', 'keep', -20, -150, 40),
    P('Broken Tower', 'tower', 130, -160, 62), P('Library Tower', 'tower', 140, 70, 58), P('Bell Tower', 'tower', -30, 70, 62),
    P("Maester's Turret", 'tower', 100, -115, 52), P('Guards Hall', 'hall', -80, 160, 26), P('Glass Gardens', 'hall', 130, 150, 24),
    P('Godswood', 'wood', -120, -170, 36, 90), P('Heart Tree', 'wood', -95, -115, 32, 30), P('Crypts', 'place', -50, -118, 16, 25),
    ...GATES.map((g) => { const p = gateAt(g, OUTER); return P(g.name, 'gate', p.x, p.z, 46, 50); }),
    P('Moat', 'water', -OUTER.hx + 20, 120, 8, 50), P('Winter Town', 'district', 200, 520, 20, 250), P('Kingsroad', 'road', 0, 880, 10, 120),
  ];
  site.addPlaces(places);

  return Object.assign(site, {
    lore: LORE,
    flyTo(p: Place) {
      site.flyToPoint(new THREE.Vector3(p.pos[0], p.pos[2] * 0.4, p.pos[1]), Math.max(160, (p.radius || 40) * 4));
    },
  });
}
