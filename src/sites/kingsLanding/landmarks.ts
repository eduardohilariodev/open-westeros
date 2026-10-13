import * as THREE from 'three';
import { BOX, CONE, CYL, DOME, OCT, ROOF, mat, part } from '../primitives';

// Procedural models for named places, keyed by the `kind` in city.json. Each gets its footprint radius (m)
// and returns a group whose origin sits on the ground at the place's centre. Add a kind here to model it.
export const LANDMARK_BUILDERS: Record<string, (r: number) => THREE.Group> = {
  castle(r) { // The Red Keep: red curtain wall, drum towers, great hall, Maegor's Holdfast, Tower of the Hand
    const g = new THREE.Group(), red = mat(0xa9573e), roof = mat(0x4d4450), w = r * 1.5, d = r * 1.05;
    const F = -50; // deep foundations so the castle reads as sitting on its rock
    for (const [x, z, l, ry] of [[0, -d / 2, w, 0], [0, d / 2, w, 0], [-w / 2, 0, d, Math.PI / 2], [w / 2, 0, d, Math.PI / 2]])
      g.add(part(BOX, red, x, F, z, l, 24 - F, 9, ry));
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]])
      g.add(part(CYL, red, (x * w) / 2, F, (z * d) / 2, 15, 44 - F, 15), part(CONE, roof, (x * w) / 2, 44, (z * d) / 2, 17, 26, 17));
    g.add(part(BOX, mat(0xb8674c), -w * 0.12, F, d * 0.05, w * 0.42, 34 - F, d * 0.3), part(ROOF, roof, -w * 0.12, 34, d * 0.05, w * 0.44, 18, d * 0.32));
    g.add(part(BOX, red, w * 0.24, F, -d * 0.12, r * 0.38, 48 - F, r * 0.38));
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]])
      g.add(part(CYL, red, w * 0.24 + x * r * 0.19, 48, -d * 0.12 + z * r * 0.19, 6, 14, 6), part(CONE, roof, w * 0.24 + x * r * 0.19, 62, -d * 0.12 + z * r * 0.19, 7, 14, 7));
    g.add(part(CYL, mat(0xb8674c), -w * 0.33, F, -d * 0.25, 12, 78 - F, 12), part(CONE, roof, -w * 0.33, 78, -d * 0.25, 14, 30, 14));
    return g;
  },
  sept(r) { // Great Sept of Baelor: marble, dome, seven crystal towers
    const g = new THREE.Group(), marble = mat(0xece7dc, { roughness: 0.5 });
    const crystal = mat(0xd8ecff, { roughness: 0.1, metalness: 0.3, emissive: 0x1a2a3a, transparent: true, opacity: 0.9 });
    g.add(part(OCT, mat(0xd8d0c0), 0, -30, 0, r, 36, r), part(OCT, marble, 0, 6, 0, r * 0.5, 32, r * 0.5));
    g.add(part(DOME, mat(0xc8d2da, { roughness: 0.35, metalness: 0.2 }), 0, 38, 0, r * 0.48, r * 0.42, r * 0.48));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2, x = Math.cos(a) * r * 0.66, z = Math.sin(a) * r * 0.66;
      g.add(part(CYL, marble, x, 6, z, 6, 62, 6), part(CONE, crystal, x, 68, z, 7, 26, 7));
    }
    return g;
  },
  pit(r) { // Dragonpit: drum with a broken dome, bronze doors
    const g = new THREE.Group();
    g.add(part(CYL, mat(0x6d6156), 0, -25, 0, r * 0.9, 55, r * 0.9));
    const broken = new THREE.SphereGeometry(1, 40, 14, 0.9, Math.PI * 1.45, 0, Math.PI / 2);
    g.add(part(broken, mat(0x5a5048, { side: THREE.DoubleSide }), 0, 30, 0, r * 0.9, r * 0.6, r * 0.9));
    g.add(part(BOX, mat(0x8c6a3a, { metalness: 0.6, roughness: 0.4 }), 0, 0, r * 0.9, 18, 22, 3));
    return g;
  },
  hall(r) {
    const g = new THREE.Group(), stone = mat(0xcbb792), roof = mat(0x6c5a4a);
    g.add(part(BOX, stone, 0, -10, 0, r * 1.6, 30, r * 0.9), part(ROOF, roof, 0, 20, 0, r * 1.7, 14, r));
    g.add(part(CYL, stone, r * 0.7, -10, 0, 7, 44, 7), part(CONE, roof, r * 0.7, 34, 0, 8, 14, 8));
    return g;
  },
  square(r) {
    const g = new THREE.Group();
    g.add(part(CYL, mat(0xd6c8a6, { roughness: 1 }), 0, -2, 0, r, 2.6, r), part(CYL, mat(0x8fa4ad), 0, 0, 0, 5, 2.5, 5));
    return g;
  },
  tower() {
    const g = new THREE.Group(), s = mat(0xb9a47f);
    g.add(part(CYL, s, 0, -6, 0, 10, 46, 10), part(CYL, s, 0, 40, 0, 12, 4, 12));
    return g;
  },
};

export const LABEL_LIFT: Record<string, number> = { castle: 150, sept: 125, pit: 75, hall: 55, gate: 50, tower: 60, hill: 70 };
